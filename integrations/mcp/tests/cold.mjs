// Official SDK client: never imports an adapter handler or policy checkout.
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fixtures, canonical, sha256, schemaDigest, expectedNormalize, expectedInspection,
  expectedAcceptance, receiptObservation, expectedReceipt, normalizeRefusals } from './oracle.mjs';
import { monitorOwnedProcesses } from './processes.mjs';

const command = process.env.MCP_COMMAND || process.execPath;
const args = JSON.parse(process.env.MCP_ARGS || JSON.stringify([new URL('../bin/agent-payment-policy-mcp.mjs', import.meta.url).pathname]));
assert.ok(Array.isArray(args) && args.every(x => typeof x === 'string'));
const serverEnvironment = { PATH: process.env.PATH, NODE_OPTIONS: '--max-old-space-size=192',
  ...JSON.parse(process.env.MCP_ENV || '{}') };
const checks = [], sessions = [], refusals = [];
const started = performance.now();
let stderr = '';
let sdkErrors = 0;
function payload(result) {
  assert.notEqual(result.isError, true, 'useful decision is a successful tool result');
  assert.notEqual(result.structuredContent, undefined, 'success has structured content');
  const text = result.content.filter(part => part.type === 'text');
  assert.equal(text.length, 1);
  assert.deepEqual(JSON.parse(text[0].text), result.structuredContent, 'bounded text equals structured result');
  return result.structuredContent;
}
async function session(fn, mode = { pin: '2026-07-28' }) {
  const finishMonitor = monitorOwnedProcesses();
  const transport = new StdioClientTransport({ command, args, cwd: process.env.MCP_CWD,
    env: serverEnvironment, stderr: 'pipe', maxBufferSize: 131072 });
  transport.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8192); });
  const client = new Client({ name: 'policy-mcp-cold-caller', version: '0.1.0' }, {
    versionNegotiation: { mode, probe: { timeoutMs: 2000, maxRetries: 0 } },
  });
  client.onerror = () => { sdkErrors++; };
  let lifecycle;
  try {
    await client.connect(transport, { timeout: 5000 });
    assert.equal(client.getProtocolEra(), 'modern');
    assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
    const info = { era: client.getProtocolEra(), protocol: client.getNegotiatedProtocolVersion(),
      server: client.getServerVersion(), discover: client.getDiscoverResult() ?? null, mode };
    await fn(client);
    sessions.push(info);
  } finally {
    await client.close().catch(() => {});
    await transport.close();
    lifecycle = await finishMonitor();
    assert.deepEqual(lifecycle.survivors, [], 'all sampled owned children/probes/workers exited');
    assert.deepEqual(lifecycle.currentChildren, [], 'client retains no children');
    sessions.push({ lifecycle });
  }
}
async function useful(client, name, arguments_, expected, label) {
  const actual = payload(await client.callTool({ name, arguments: arguments_ }, { timeout: 5000 }));
  assert.deepEqual(actual, expected, label); checks.push(label); return actual;
}
async function refuse(client, name, arguments_, label, expectedCode) {
  try {
    const result = await client.callTool({ name, arguments: arguments_ }, { timeout: 5000 });
    assert.equal(result.isError, true, `${label} fails as a tool result`);
    assert.equal(result.structuredContent, undefined, `${label} error bypasses success schema`);
    const texts = result.content.filter(p => p.type === 'text');
    assert.equal(texts.length, 1);
    assert.ok(Buffer.byteLength(texts[0].text) < 1024, 'error is bounded');
    assert.doesNotMatch(texts[0].text, /synthetic-do-not-echo|\/home\/|node_modules|Error:.*\n|\bat\s+\S+\s*\(/);
    const error = JSON.parse(texts[0].text).error;
    assert.equal(typeof error.code, 'string');
    if (expectedCode) assert.equal(error.code, expectedCode, label);
    refusals.push({ label, surface: 'tool', code: error.code });
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    // Missing/wrong arguments and unknown tool may be rejected by official registration.
    assert.ok([-32601, -32602, -32600].includes(error.code), `${label}: expected protocol argument error, got ${error.code}`);
    assert.ok(String(error.message).length < 2048);
    refusals.push({ label, surface: 'protocol', code: error.code });
  }
  checks.push(label);
  await useful(client, 'normalize_request', {
    method: 'POST', target: fixtures.request.target, options: { body: fixtures.request.body },
  }, expectedNormalize(), `recovery_${label}`);
}

await session(async client => {
  const listed = await client.listTools(undefined, { timeout: 5000 });
  assert.deepEqual(listed.tools.map(t => t.name).sort(), ['accept_output', 'classify_receipt', 'inspect_output_schema', 'normalize_request']);
  for (const tool of listed.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.outputSchema, `${tool.name} advertises output schema`);
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  }
  checks.push('finite_truthful_discovery');
  for (const [name, body] of [['body', fixtures.request.body], ['reordered', fixtures.request.reorderedBody], ['changed', fixtures.request.changedBody]]) {
    await useful(client, 'normalize_request', { method: 'POST', target: fixtures.request.target, options: { body, mediaType: 'application/json' } }, expectedNormalize(body), `normalize_${name}`);
  }
  await useful(client, 'inspect_output_schema', { schema: fixtures.schema, requiredFields: fixtures.requiredFields }, expectedInspection, 'schema_digest_and_required_paths');
  for (const [name, output] of Object.entries(fixtures.outputs)) {
    await useful(client, 'accept_output', { schema: fixtures.schema, schemaDigest, output }, expectedAcceptance(name), `accept_${name}`);
  }
  await useful(client, 'accept_output', { schema: fixtures.schema, schemaDigest: `sha256:${'0'.repeat(64)}`, output: fixtures.outputs.valid }, { valid: false }, 'accept_wrong_digest');
  await useful(client, 'accept_output', { schema: { type: 'object', $ref: 'https://untrusted.invalid/schema' }, schemaDigest, output: fixtures.outputs.valid }, { valid: false }, 'accept_unsupported_schema');
  await useful(client, 'accept_output', { schema: { type: 'object' }, schemaDigest, output: fixtures.outputs.valid }, { valid: false }, 'accept_malformed_schema');
  for (const variant of fixtures.receiptVariants) {
    await useful(client, 'classify_receipt', receiptObservation(variant), expectedReceipt(variant), `receipt_${variant.name}`);
  }
  for (const [label, arguments_] of normalizeRefusals) await refuse(client, 'normalize_request', arguments_, label);
  await refuse(client, 'normalize_request', { method: 'GET' }, 'missing_argument');
  await refuse(client, 'normalize_request', { method: 'GET', target: fixtures.request.target, extra: true }, 'extra_argument');
  await refuse(client, 'normalize_request', { method: 12, target: fixtures.request.target }, 'wrong_argument_type');
  await refuse(client, 'no_such_tool', {}, 'unknown_tool');
  await refuse(client, 'inspect_output_schema', { schema: fixtures.schema, requiredFields: ['not.guaranteed'] }, 'schema_missing_guarantee');
  await refuse(client, 'inspect_output_schema', { schema: { ...fixtures.schema, $ref: 'https://untrusted.invalid/schema' } }, 'schema_external_ref');
  await refuse(client, 'inspect_output_schema', { schema: { ...fixtures.schema, madeUpKeyword: true } }, 'schema_unsupported_keyword');
  await refuse(client, 'normalize_request', { method: 'POST', target: fixtures.request.target, options: { body: { value: 'x'.repeat(70000) } } }, 'oversize_arguments', 'ARGUMENT_LIMIT');
  await refuse(client, 'normalize_request', { method: 'POST', target: fixtures.request.target, options: { body: { value: 'x'.repeat(40000) } } }, 'oversize_string', 'ARGUMENT_LIMIT');
  await refuse(client, 'normalize_request', { method: 'POST', target: fixtures.request.target, options: { body: Array(2000).fill(0) } }, 'oversize_array', 'ARGUMENT_LIMIT');
  let deep = {};
  for (let i = 0; i < 80; i++) deep = { nested: deep };
  await refuse(client, 'normalize_request', { method: 'POST', target: fixtures.request.target, options: { body: deep } }, 'overdeep_arguments', 'ARGUMENT_LIMIT');
  const hostileSchema = { type: 'object', properties: { value: { type: 'string', pattern: '^(a+)+$' } }, required: ['value'], additionalProperties: false };
  const hostileArgs = { schema: hostileSchema, schemaDigest: sha256(canonical(hostileSchema)), output: { value: `${'a'.repeat(128)}!` } };
  const workStarted = performance.now();
  await refuse(client, 'accept_output', hostileArgs, 'bounded_sync_schema_work', 'WORK_LIMIT');
  assert.ok(performance.now() - workStarted < 5000, 'worker work bound is enforceable');
  const controller = new AbortController();
  const cancellationStarted = performance.now();
  const timer = setTimeout(() => controller.abort(), 150);
  try {
    await assert.rejects(client.callTool({ name: 'accept_output', arguments: hostileArgs }, { signal: controller.signal, timeout: 5000 }));
    checks.push('schema_work_client_cancellation');
  } finally { clearTimeout(timer); }
  await useful(client, 'normalize_request', { method: 'POST', target: fixtures.request.target, options: { body: fixtures.request.body } }, expectedNormalize(), 'recovery_after_cancellation');
  assert.ok(performance.now() - cancellationStarted < 1000, 'actual server cancellation interrupts work before its 1500ms deadline');
});

// Auto mode exercises the official SDK's disposable discovery sibling process.
await session(async client => {
  await client.listTools(undefined, { timeout: 5000 });
  await useful(client, 'normalize_request', { method: 'POST', target: fixtures.request.target, options: { body: fixtures.request.body } }, expectedNormalize(), 'cold_restart_same_useful_result');
}, 'auto');
await assert.rejects(access('/tmp/root2934-must-not-run'), { code: 'ENOENT' });
assert.ok(Buffer.byteLength(stderr) < 8192, 'diagnostics bounded');
assert.doesNotMatch(stderr, /synthetic-do-not-echo|\/home\/|node_modules|\bat\s+\S+\s*\(/);
console.log(JSON.stringify({ ok: true, checks, refusals, sessions, sdkErrors, stderrBytes: Buffer.byteLength(stderr), elapsedMs: Math.round(performance.now() - started) }));
