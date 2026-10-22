import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { monitorOwnedProcesses } from './processes.mjs';
import { expectedNormalize, fixtures, sha256, canonical } from './oracle.mjs';

const bin = new URL('../bin/agent-payment-policy-mcp.mjs', import.meta.url).pathname;
const unsupportedNode = process.argv[2];
assert.ok(unsupportedNode, 'pass a checked official Node20 binary');
const old = spawnSync(unsupportedNode, [bin], { encoding: 'utf8', timeout: 3000, maxBuffer: 4096,
  env: { PATH: process.env.PATH } });
assert.ifError(old.error);
assert.equal(old.status, 1);
assert.equal(old.stdout, '');
assert.equal(old.stderr, 'agent-payment-policy-mcp requires Node.js >=22.\n');
const checks = ['actual_Node20_fails_before_import_or_use'];

const monitor = monitorOwnedProcesses();
const child = spawn(process.execPath, ['--max-old-space-size=128', bin], { stdio: ['pipe','pipe','pipe'],
  env: { PATH: process.env.PATH } });
let stdout = '', stderr = '';
child.stdout.on('data', b => { stdout = (stdout+b).slice(-4096); });
child.stderr.on('data', b => { stderr = (stderr+b).slice(-4096); });
child.stdin.on('error', () => {});
try {
  await once(child, 'spawn');
  child.stdin.write('x'.repeat(140000));
  await Promise.race([once(child, 'exit'), delay(3000).then(() => { throw new Error('oversize wire did not close'); })]);
  assert.equal(stdout, '', 'oversize non-message never appears on protocol output');
  assert.match(stderr, /^MCP input or transport error\.\n$/);
  checks.push('oversize_wire_closes_with_bounded_diagnostic');
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'close'), delay(1000)]);
    if (child.exitCode === null) { child.kill('SIGKILL'); await once(child, 'close'); }
  }
  const lifecycle = await monitor();
  assert.deepEqual(lifecycle.survivors, []);
  assert.deepEqual(lifecycle.currentChildren, []);
}

// Recovery is a fresh process after the documented wire-buffer close.
const transport = new StdioClientTransport({ command: process.execPath, args: ['--max-old-space-size=128', bin],
  env: { PATH: process.env.PATH }, stderr: 'pipe' });
const client = new Client({ name: 'wire-limit-recovery', version: '0.1.0' }, {
  versionNegotiation: { mode: { pin: '2026-07-28' } },
});
const finish = monitorOwnedProcesses();
try {
  await client.connect(transport);
  const result = await client.callTool({ name: 'normalize_request', arguments: {
    method: 'POST', target: fixtures.request.target, options: { body: fixtures.request.body },
  } });
  assert.deepEqual(result.structuredContent, expectedNormalize());
  checks.push('oversize_wire_restart_useful_recovery');
  const schema = { type: 'object', properties: { value: { type: 'string', pattern: '^(a+)+$' } }, required: ['value'], additionalProperties: false };
  const pending = client.callTool({ name: 'accept_output', arguments: {
    schema, schemaDigest: sha256(canonical(schema)), output: { value: 'a'.repeat(128) + '!' },
  } }).then(() => 'unexpected-result', () => 'disconnected');
  await delay(150);
  const beforeClose = performance.now();
  await client.close();
  assert.equal(await pending, 'disconnected');
  assert.ok(performance.now() - beforeClose < 1000, 'disconnect stops in-flight synchronous worker before its deadline');
  checks.push('disconnect_interrupts_inflight_schema_worker');
} finally {
  await client.close();
  await transport.close();
  const lifecycle = await finish();
  assert.deepEqual(lifecycle.survivors, []);
  assert.deepEqual(lifecycle.currentChildren, []);
}
console.log(JSON.stringify({ ok: true, checks, unsupportedNode: old.stderr.trim() }));
