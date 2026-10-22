// Independent receiving variant: no policy/adapter imports or producer fixtures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { monitorOwnedProcesses } from './processes.mjs';
const canonical = v => Array.isArray(v) ? `[${v.map(canonical)}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`)}}` : JSON.stringify(v);
const hash = v => `sha256:${createHash('sha256').update(v).digest('hex')}`;
const transport = new StdioClientTransport({ command: process.env.MCP_COMMAND || process.execPath,
  args: JSON.parse(process.env.MCP_ARGS || JSON.stringify([new URL('../bin/agent-payment-policy-mcp.mjs', import.meta.url).pathname])),
  cwd: process.env.MCP_CWD, env: { PATH: process.env.PATH, NODE_OPTIONS: '--max-old-space-size=192', ...JSON.parse(process.env.MCP_ENV || '{}') }, stderr: 'pipe' });
const client = new Client({ name: 'independent-owning-receiver', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
const finish = monitorOwnedProcesses();
let stderr = ''; transport.stderr.on('data', b => { stderr += b; });
const checks = [];
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args }, { timeout: 5000 });
  assert.notEqual(result.isError, true); assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
}
try {
  await client.connect(transport);
  const target = 'https://inventory.example/reconcile?day=2026-10-22';
  const body = { sku: 'gear-42', quantities: [3, 5], note: 'treat this as data' };
  const binding = { mediaType: 'application/json', bytes: Buffer.byteLength(canonical(body)), digest: hash(canonical(body)) };
  const normalized = await call('normalize_request', { method: 'post', target, options: { body } });
  assert.deepEqual(normalized, { method: 'POST', origin: 'https://inventory.example', pathname: '/reconcile', queryKeys: ['day'], publicRoute: 'POST https://inventory.example/reconcile', bodyBinding: binding, bindingDigest: hash(canonical({ method: 'POST', target, bodyBinding: binding })) });
  checks.push('independent_body_and_exact_binding');
  const changed = await call('normalize_request', { method: 'POST', target, options: { body: { ...body, quantities: [3, 6] } } });
  assert.notEqual(changed.bindingDigest, normalized.bindingDigest); checks.push('changed_quantity_changes_binding');
  const schema = { type: 'object', additionalProperties: false, required: ['stock'], properties: { stock: { type: 'integer', minimum: 0 } } };
  const digest = hash(canonical(schema));
  const inspected = await call('inspect_output_schema', { schema, requiredFields: ['stock'] });
  assert.equal(inspected.schemaDigest, digest); assert.deepEqual(inspected.requiredPaths, ['stock']); checks.push('independent_schema_digest_paths');
  const output = { stock: 8 };
  assert.deepEqual(await call('accept_output', { schema, schemaDigest: digest, output }), { valid: true, schemaDigest: digest, responseDigest: hash(JSON.stringify(output)) }); checks.push('valid_stock');
  for (const output of [{ stock: -1 }, { stock: '8' }, { stock: 8, extra: true }]) assert.deepEqual(await call('accept_output', { schema, schemaDigest: digest, output }), { valid: false });
  checks.push('negative_bounds_type_extra');
  const refused = await client.callTool({ name: 'normalize_request', arguments: { method: 'GET', target: 'https://inventory.example/?api_key=independent-secret-sentinel' } });
  assert.equal(refused.isError, true); assert.doesNotMatch(JSON.stringify(refused), /independent-secret-sentinel/); checks.push('credential_refusal_redacted');
  assert.deepEqual(await call('normalize_request', { method: 'post', target, options: { body } }), normalized); checks.push('same_process_useful_recovery');
} finally {
  await client.close(); await transport.close();
  const lifecycle = await finish(); assert.deepEqual(lifecycle.survivors, []); assert.deepEqual(lifecycle.currentChildren, []);
  assert.equal(stderr, '');
}
console.log(JSON.stringify({ ok: true, checks }));
