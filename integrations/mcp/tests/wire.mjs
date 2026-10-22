// Small raw-wire negative controls alongside the official-client useful calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { monitorOwnedProcesses } from './processes.mjs';

const command = process.env.MCP_COMMAND || process.execPath;
const args = JSON.parse(process.env.MCP_ARGS || JSON.stringify([new URL('../bin/agent-payment-policy-mcp.mjs', import.meta.url).pathname]));
const finishMonitor = monitorOwnedProcesses();
const child = spawn(command, args, { cwd: process.env.MCP_CWD, shell: false,
  env: { PATH: process.env.PATH, NODE_OPTIONS: '--max-old-space-size=192', ...JSON.parse(process.env.MCP_ENV || '{}') },
  stdio: ['pipe', 'pipe', 'pipe'] });
const responses = new Map();
let pending = '', stderr = '', bytes = 0, parseFailure;
child.stdout.on('data', chunk => {
  bytes += chunk.length;
  if (bytes > 131072) { parseFailure = new Error('unbounded stdout'); return; }
  pending += chunk.toString();
  const lines = pending.split('\n'); pending = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try { const value = JSON.parse(line); if (value.id !== undefined) responses.set(value.id, value); }
    catch { parseFailure = new Error('stdout contains non-protocol bytes'); }
  }
});
child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
child.stdin.on('error', () => {});
function meta(version) {
  return { 'io.modelcontextprotocol/protocolVersion': version,
    'io.modelcontextprotocol/clientInfo': { name: 'policy-wire-negative-control', version: '0.1.0' },
    'io.modelcontextprotocol/clientCapabilities': {} };
}
function send(id, version) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'server/discover', params: { _meta: meta(version) } })}\n`);
}
async function receive(id) {
  const deadline = Date.now() + 5000;
  while (!responses.has(id) && Date.now() < deadline && child.exitCode === null && !parseFailure) await delay(10);
  if (parseFailure) throw parseFailure;
  assert.ok(responses.has(id), `wire response ${id} within deadline`);
  return responses.get(id);
}
let lifecycle;
try {
  await once(child, 'spawn');
  child.stdin.write('{not-valid-json}\n');
  send(1, '2099-01-01');
  const unsupported = await receive(1);
  assert.ok(unsupported.error, 'unsupported protocol is a protocol failure');
  assert.deepEqual(unsupported.error.data, { supported: ['2026-07-28'], requested: '2099-01-01' });
  assert.equal(unsupported.result, undefined);
  send(2, '2026-07-28');
  const recovered = await receive(2);
  assert.ok(recovered.result, 'same process recovers after malformed line and unsupported protocol');
  assert.equal(recovered.error, undefined);
  assert.equal(pending, '', 'stdout ends on a complete protocol message');
  assert.doesNotMatch(stderr, /\/home\/|node_modules|\bat\s+\S+\s*\(/);
  child.stdin.end();
  for (let i = 0; i < 100 && child.exitCode === null; i++) await delay(10);
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([once(child, 'close'), delay(1000)]);
  lifecycle = await finishMonitor();
  assert.deepEqual(lifecycle.survivors, []);
  assert.deepEqual(lifecycle.currentChildren, []);
  console.log(JSON.stringify({ ok: true, cases: ['malformed_json_line', 'unsupported_protocol', 'same_process_modern_discovery_recovery', 'stdout_protocol_only'],
    unsupportedCode: unsupported.error.code, stdoutBytes: bytes, stderrBytes: Buffer.byteLength(stderr), lifecycle }));
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  if (!lifecycle) await finishMonitor();
}
