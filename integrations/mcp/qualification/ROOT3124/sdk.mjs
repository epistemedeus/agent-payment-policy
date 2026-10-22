// ROOT3082 official SDK mechanics, adapted to the received public npm URL command.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const O = path.dirname(new URL(import.meta.url).pathname), R = path.resolve(O, '../..');
const S = R+'/evidence/ROOT3124';
const require = createRequire(S+'/client/package.json');
const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client')));
const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client/stdio')));
const { monitorOwnedProcesses } = await import(pathToFileURL(R+'/tests/processes.mjs'));
const a = JSON.parse(readFileSync(O+'/ACQUISITION.json')), f = JSON.parse(readFileSync(O+'/FROZEN-CASE.json'));
// Freeze the public contract from the received artifact before connecting, not from tools/list.
const { tools } = await import(pathToFileURL(a.installed+'/src/tools/index.mjs'));
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const inventory = tools.map(({ name, inputSchema, outputSchema }) => ({ name, inputSchema, outputSchema, annotations }));
const sessions = [];
function payload(r) {
  assert.notEqual(r.isError, true); assert.equal(r.content.length, 1); assert.equal(r.content[0].type, 'text');
  assert.deepEqual(JSON.parse(r.content[0].text), r.structuredContent); return r.structuredContent;
}
try {
  for (const era of ['modern', 'legacy']) for (const restart of [false, true]) {
    const finish = monitorOwnedProcesses(), record = { era, restart, checks: [] };
    const argv = ['python3', R+'/scripts/npm-stdio.py', 'npm', ...a.npmArgs, '--offline', '--', 'agent-payment-policy-mcp'];
    record.argv = argv;
    const transport = new StdioClientTransport({ command: argv[0], args: argv.slice(1), cwd: S+'/consumer',
      env: a.environment, stderr: 'pipe', maxBufferSize: 131072 });
    let stderr = ''; transport.stderr.on('data', b => { stderr = (stderr+b).slice(-4096); });
    const client = new Client({ name: 'root3124-public-packing-receiver', version: '1' }, {
      versionNegotiation: { mode: era === 'modern' ? { pin: '2026-07-28' } : 'legacy' },
      ...(era === 'legacy' ? { supportedProtocolVersions: ['2025-06-18'] } : {}),
    });
    try {
      await client.connect(transport, { timeout: 5000 }); assert.equal(client.getProtocolEra(), era);
      record.negotiated = client.getNegotiatedProtocolVersion();
      assert.equal(record.negotiated, era === 'modern' ? '2026-07-28' : '2025-06-18');
      const listed = (await client.listTools(undefined, { timeout: 5000 })).tools;
      assert.deepEqual(listed.map(t => t.name).sort(), f.inventoryNames);
      for (const expected of inventory) {
        const found = listed.find(t => t.name === expected.name);
        for (const key of ['inputSchema', 'outputSchema', 'annotations']) assert.deepEqual(found[key], expected[key]);
      }
      record.exactSchemasAnnotations = true;
      for (const c of f.cases) {
        const actual = payload(await client.callTool({ name: c.name, arguments: c.args }, { timeout: 5000 }));
        assert.deepEqual(actual, c.expected, c.label);
        record.checks.push({ label: c.label, tool: c.name, actual, matchesFrozenExpected: true });
      }
      if (!restart) {
        const bad = await client.callTool({ name: f.refusal.name, arguments: f.refusal.args }, { timeout: 5000 });
        assert.equal(bad.isError, true); assert.equal(bad.structuredContent, undefined);
        const text = JSON.stringify(bad); assert.ok(Buffer.byteLength(text) < 2048);
        assert.ok(!text.includes('root3124-synthetic-do-not-echo'));
        record.refusal = { output: bad, bytes: Buffer.byteLength(text), sentinelAbsent: true };
        const c = f.cases[0]; record.recovery = payload(await client.callTool({ name: c.name, arguments: c.args }, { timeout: 5000 }));
        assert.deepEqual(record.recovery, c.expected);
      }
      record.ok = true;
    } finally {
      await client.close().catch(() => {}); await transport.close(); record.lifecycle = await finish();
      record.stderrBytes = Buffer.byteLength(stderr); sessions.push(record);
      assert.deepEqual(record.lifecycle.survivors, []); assert.deepEqual(record.lifecycle.currentChildren, []); assert.equal(stderr, '');
    }
  }
  console.log(JSON.stringify({ ok: true, sessions: sessions.length, usefulDecisions: sessions.reduce((n,s) => n+s.checks.length, 0) }));
} finally {
  writeFileSync(O+'/SDK-RECEIVING.json', JSON.stringify({ ok: sessions.length === 4 && sessions.every(s => s.ok),
    inventory, sessions, networkIsolation: 'Existing no-egress.py inherited by client, npm and server descendants' }, null, 2)+'\n');
}
