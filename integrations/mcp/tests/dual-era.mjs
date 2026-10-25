// Official clients, one package/factory, independent useful expectations.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { cases, refusals } from './supplier-case.mjs';
import { canonical, sha256 } from './oracle.mjs';
import { monitorOwnedProcesses } from './processes.mjs';

const command = process.env.MCP_COMMAND || process.execPath;
const args = JSON.parse(process.env.MCP_ARGS || JSON.stringify([new URL('../bin/agent-payment-policy-mcp.mjs', import.meta.url).pathname]));
const expectedAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const sessions = [];
let inventory;
const hostileSchema = { type: 'object', properties: { value: { type: 'string', pattern: '^(a+)+$' } }, required: ['value'], additionalProperties: false };
const hostile = { name: 'accept_output', arguments: { schema: hostileSchema,
  schemaDigest: sha256(canonical(hostileSchema)), output: { value: `${'a'.repeat(128)}!` } } };
function payload(result) {
  assert.notEqual(result.isError, true);
  assert.notEqual(result.structuredContent, undefined);
  assert.equal(result.content.length, 1);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
}
for (const era of ['modern', 'legacy']) {
  for (const restart of [false, true]) {
    const finish = monitorOwnedProcesses();
    const transport = new StdioClientTransport({ command, args, cwd: process.env.MCP_CWD,
      env: { PATH: process.env.PATH, NODE_OPTIONS: '--max-old-space-size=192', ...JSON.parse(process.env.MCP_ENV || '{}') }, stderr: 'pipe', maxBufferSize: 131072 });
    let stderr = ''; transport.stderr.on('data', b => { stderr = (stderr + b).slice(-8192); });
    const client = new Client({ name: 'root3033-useful-receiver', version: '1' }, {
      versionNegotiation: { mode: era === 'modern' ? { pin: '2026-07-28' } : 'legacy' },
      ...(era === 'legacy' ? { supportedProtocolVersions: ['2025-06-18'] } : {}),
    });
    const checks = [], refused = [];
    const record = { era, restart, checks, refusals: refused };
    try {
      await client.connect(transport, { timeout: 5000 });
      assert.equal(client.getProtocolEra(), era);
      record.negotiated = client.getNegotiatedProtocolVersion();
      record.requested = era === 'modern' ? '2026-07-28' : '2025-06-18';
      assert.equal(record.negotiated, record.requested);
      const listed = (await client.listTools(undefined, { timeout: 5000 })).tools;
      assert.deepEqual(listed.map(t => t.name).sort(), ['accept_output', 'classify_receipt', 'inspect_output_schema', 'normalize_request']);
      for (const tool of listed) {
        assert.deepEqual(tool.annotations, expectedAnnotations);
        assert.equal(tool.inputSchema.type, 'object');
        assert.equal(tool.inputSchema.additionalProperties, false);
        assert.equal(tool.outputSchema.type, 'object');
      }
      assert.equal(listed.find(t => t.name === 'accept_output').outputSchema.oneOf.length, 2);
      if (inventory) assert.deepEqual(listed, inventory, 'identical schema/annotation inventory across eras and restarts');
      else inventory = listed;
      checks.push('exact_inventory_annotations_input_output_schemas');
      for (const c of restart ? [cases[0], cases[3]] : cases) {
        assert.deepEqual(payload(await client.callTool({ name: c.name, arguments: c.args }, { timeout: 5000 })), c.expected, c.label);
        checks.push(c.label);
      }
      if (!restart) {
        for (const c of refusals) {
          try {
            const result = await client.callTool({ name: c.name, arguments: c.args }, { timeout: 5000 });
            assert.equal(result.isError, true);
            assert.equal(result.structuredContent, undefined);
            const text = JSON.stringify(result);
            assert.ok(Buffer.byteLength(text) < 2048);
            assert.doesNotMatch(text, /root3033-do-not-echo|\/home\/|node_modules|Error:|\bat\s+\S+\s*\(/);
            refused.push({ label: c.label, surface: 'tool', code: JSON.parse(result.content[0].text).error.code });
          } catch (error) {
            if (error instanceof assert.AssertionError) throw error;
            assert.ok([-32600, -32601, -32602].includes(error.code));
            assert.doesNotMatch(error.message, /root3033-do-not-echo/);
            refused.push({ label: c.label, surface: 'protocol', code: error.code });
          }
          assert.deepEqual(payload(await client.callTool({ name: cases[0].name, arguments: cases[0].args })), cases[0].expected);
        }
        checks.push('bounded_refusals_then_useful_recovery');
        const start = performance.now();
        const limited = await client.callTool(hostile, { timeout: 5000 });
        assert.equal(limited.isError, true);
        assert.equal(JSON.parse(limited.content[0].text).error.code, 'WORK_LIMIT');
        record.workerTimeoutMs = Math.round(performance.now() - start);
        assert.ok(record.workerTimeoutMs < 3500);
        assert.deepEqual(payload(await client.callTool({ name: cases[0].name, arguments: cases[0].args })), cases[0].expected);
        checks.push('hostile_sync_worker_timeout_and_recovery');
        const controller = new AbortController();
        const cancellationStart = performance.now();
        const timer = setTimeout(() => controller.abort(), 150);
        try { await assert.rejects(client.callTool(hostile, { signal: controller.signal, timeout: 5000 })); }
        finally { clearTimeout(timer); }
        assert.deepEqual(payload(await client.callTool({ name: cases[0].name, arguments: cases[0].args })), cases[0].expected);
        record.cancellationRecoveryMs = Math.round(performance.now() - cancellationStart);
        assert.ok(record.cancellationRecoveryMs < 1000, 'server abort actually interrupts synchronous work before 1500ms deadline');
        checks.push('real_cancellation_and_useful_recovery');
        const pending = client.callTool(hostile).then(() => 'answered', () => 'disconnected');
        await new Promise(resolve => setTimeout(resolve, 150));
        const disconnectStart = performance.now();
        await client.close();
        assert.equal(await pending, 'disconnected');
        record.disconnectMs = Math.round(performance.now() - disconnectStart);
        assert.ok(record.disconnectMs < 1000);
        checks.push('inflight_disconnect_before_worker_timeout');
      }
    } finally {
      await client.close().catch(() => {}); await transport.close();
      record.lifecycle = await finish();
      assert.deepEqual(record.lifecycle.survivors, []); assert.deepEqual(record.lifecycle.currentChildren, []);
      assert.equal(stderr, ''); sessions.push(record);
    }
  }
}
console.log(JSON.stringify({ ok: true, sessions, inventory }));
