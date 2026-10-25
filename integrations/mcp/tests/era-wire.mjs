// Bounded wire controls around the official entry's per-connection era pinning.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { cases } from './supplier-case.mjs';
import { monitorOwnedProcesses } from './processes.mjs';

const meta = version => ({ 'io.modelcontextprotocol/protocolVersion': version,
  'io.modelcontextprotocol/clientInfo': { name: 'root3033-era-receiver', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {} });
const results = [];
for (const era of ['modern', 'legacy']) {
  const finish = monitorOwnedProcesses();
  const child = spawn(process.env.MCP_COMMAND || process.execPath,
    JSON.parse(process.env.MCP_ARGS || JSON.stringify([new URL('../bin/agent-payment-policy-mcp.mjs', import.meta.url).pathname])),
    { cwd: process.env.MCP_CWD, env: { PATH: process.env.PATH, NODE_OPTIONS: '--max-old-space-size=192', ...JSON.parse(process.env.MCP_ENV || '{}') }, stdio: ['pipe', 'pipe', 'pipe'] });
  const responses = new Map(); let pending = '', stderr = '', count = 0, id = 0, parseError;
  child.stdout.on('data', b => {
    count += b.length;
    if (count > 131072) { parseError = new Error('output bound'); return; }
    pending += b;
    const lines = pending.split('\n'); pending = lines.pop();
    for (const line of lines) { try { const msg = JSON.parse(line); if (msg.id !== undefined) responses.set(msg.id, msg); } catch { parseError = new Error('non-protocol output'); } }
  });
  child.stderr.on('data', b => { stderr = (stderr + b).slice(-4096); });
  child.stdin.on('error', () => {});
  const send = (method, params, notify = false) => {
    const number = ++id;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: number }), method, params }) + '\n');
    return number;
  };
  async function receive(number) {
    const end = Date.now() + 5000;
    while (!responses.has(number) && Date.now() < end && child.exitCode === null && !parseError) await delay(10);
    if (parseError) throw parseError;
    assert.ok(responses.has(number), `response ${number}`);
    return responses.get(number);
  }
  const request = async (method, params) => receive(send(method, params));
  const params = value => era === 'modern' ? { ...value, _meta: meta('2026-07-28') } : value;
  const record = { era, checks: [] };
  try {
    await once(child, 'spawn');
    child.stdin.write('{malformed-json}\n');
    const unsupported = await request('server/discover', { _meta: meta('2099-01-01') });
    assert.equal(unsupported.error.code, -32022);
    assert.deepEqual(unsupported.error.data, { supported: ['2026-07-28'], requested: '2099-01-01' });
    record.checks.push('malformed_and_unsupported_opening_then_recovery');
    if (era === 'modern') {
      const discover = await request('server/discover', params({})); assert.ok(discover.result);
    } else {
      // Legacy initialization counter-offers a supported legacy revision for an
      // unknown offer; it does not advertise modern revisions via initialize.
      const init = await request('initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'root3033-era-receiver', version: '1' } });
      assert.equal(init.result.protocolVersion, '2025-11-25');
      send('notifications/initialized', {}, true);
      record.requested = '2099-01-01';
      record.negotiated = init.result.protocolVersion;
      record.checks.push('official_legacy_unsupported_offer_counteroffer');
    }
    const listed = await request('tools/list', params({})); assert.equal(listed.result.tools.length, 4);
    const crossed = era === 'modern'
      ? await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cross-era', version: '1' } })
      : await request('server/discover', { _meta: meta('2026-07-28') });
    assert.ok(crossed.error, 'opposite era cannot switch an established connection');
    record.crossEraCode = crossed.error.code;
    record.checks.push('no_midconnection_cross_era_switch');
    child.stdin.write('{malformed-again}\n');
    const recovered = await request('tools/call', params({ name: cases[0].name, arguments: cases[0].args }));
    assert.deepEqual(recovered.result.structuredContent, cases[0].expected);
    assert.deepEqual(JSON.parse(recovered.result.content[0].text), cases[0].expected);
    record.checks.push('same_era_useful_recovery_after_malformed_and_cross_era_refusal');
    const close = once(child, 'close');
    child.stdin.end();
    await Promise.race([close, delay(1500).then(() => { if (child.exitCode === null) throw new Error('EOF did not close'); })]);
    assert.equal(child.exitCode, 0);
    record.checks.push('EOF_clean_exit');
    assert.doesNotMatch(stderr, /\/home\/|node_modules|root3033-do-not-echo/);
    assert.ok(Buffer.byteLength(stderr) <= 4 * Buffer.byteLength('MCP input or transport error.\n'));
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'close'); }
    record.lifecycle = await finish();
    assert.deepEqual(record.lifecycle.survivors, []); assert.deepEqual(record.lifecycle.currentChildren, []);
    results.push(record);
  }
}
console.log(JSON.stringify({ ok: true, results }));
