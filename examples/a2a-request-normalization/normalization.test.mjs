import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import dns from 'node:dns';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { after, before, test, mock } from 'node:test';
import { TaskState } from '@a2a-js/sdk';
import { normalizeRequest } from '../../core.mjs';
import { startServer, MAX_DATA_BYTES, MAX_WIRE_BYTES, MAX_DEPTH } from './server.mjs';
import { callNormalization } from './client.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await server?.stop(); });
const headers = { 'content-type': 'application/json', 'a2a-version': '1.0' };
const input = { method: 'GET', target: 'https://seller.example/data?asset=ETH&window=5m' };
function direct(value) {
  try { return { ok: true, result: normalizeRequest(value.method, value.target, value.options) }; }
  catch (error) { return { ok: false, error: { name: error.name, message: error.message } }; }
}
function wire(value = input) {
  return {
    jsonrpc: '2.0', id: randomUUID(), method: 'SendMessage',
    params: { message: { messageId: randomUUID(), role: 'ROLE_USER', parts: [{ data: value, mediaType: 'application/json' }] } },
  };
}
async function raw(body, { extraHeaders = {}, path = '/', method = 'POST' } = {}) {
  const response = await fetch(new URL(path, server.url), {
    method, headers: { ...headers, ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}
async function recovered() {
  const result = await callNormalization(server.url, input);
  assert.deepEqual(result.envelope, direct(input));
}

test('real SDK client discovers accurately scoped card and receives structured artifact', async () => {
  const { card, task, envelope } = await callNormalization(server.url, input);
  assert.deepEqual(envelope, direct(input));
  assert.equal(card.supportedInterfaces[0].protocolVersion, '1.0');
  assert.equal(card.supportedInterfaces[0].protocolBinding, 'JSONRPC');
  assert.equal(card.supportedInterfaces[0].url, server.url);
  assert.equal(card.skills.length, 1);
  assert.equal(card.skills[0].id, 'normalize-request');
  assert.equal(card.capabilities.streaming, false);
  assert.equal(card.capabilities.pushNotifications, false);
  assert.equal(task.status.state, TaskState.TASK_STATE_COMPLETED);
  assert.deepEqual(task.history, []);
  assert.equal(task.artifacts[0].parts[0].mediaType, 'application/json');
  assert.doesNotMatch(JSON.stringify(task), /ETH|5m/);
});

const cases = [
  ['query binding', input],
  ['default method', { target: 'https://seller.example/data?z=2&a=1&a=2' }],
  ['lowercase method and canonical URL', { method: 'get', target: 'https://SELLER.example:443/a/../data?q=x#fragment' }],
  ['POST body', { method: 'POST', target: 'https://seller.example/analyze?mode=fast', options: { body: { types: ['A', 'MX'], domain: 'buyer.example' }, mediaType: 'application/json' } }],
  ['PUT body', { method: 'PUT', target: 'https://seller.example/analyze', options: { body: [true, null, 1] } }],
  ['PATCH body', { method: 'PATCH', target: 'https://seller.example/analyze', options: { body: { z: 2, a: 1 } } }],
  ['unknown HTTP method retains direct core semantics', { method: 'BREW', target: 'https://seller.example/data' }],
  ['missing body', { method: 'POST', target: 'https://seller.example/analyze' }],
  ['body on GET', { ...input, options: { body: {} } }],
  ['unsupported body media', { method: 'POST', target: 'https://seller.example/analyze', options: { body: {}, mediaType: 'text/plain' } }],
  ['invalid method', { ...input, method: '??' }],
  ['malformed target', { ...input, target: 'not a URL' }],
  ['unsupported HTTP URL', { ...input, target: 'http://seller.example/data' }],
  ['file target', { ...input, target: 'file:///etc/passwd' }],
  ['credential query refusal', { ...input, target: 'https://seller.example/data?api_key=SYNTHETIC' }],
  ['userinfo refusal', { ...input, target: 'https://user:SYNTHETIC@seller.example/data' }],
  ['private IP refusal', { ...input, target: 'https://127.0.0.1/data' }],
  ['local hostname refusal', { ...input, target: 'https://localhost/data' }],
  ['port refusal', { ...input, target: 'https://seller.example:8443/data' }],
  ['unresolvable domain is normalized without DNS', { ...input, target: 'https://never-resolve.invalid/data' }],
];
for (const [label, value] of cases) {
  test(`complete direct result/refusal: ${label}`, async () => {
    const received = await callNormalization(server.url, value);
    const expected = direct(value);
    assert.deepEqual(received.envelope, expected);
    assert.equal(received.task.status.state, expected.ok ? TaskState.TASK_STATE_COMPLETED : TaskState.TASK_STATE_REJECTED);
    assert.deepEqual(received.task.history, []);
    if (!expected.ok) await recovered();
  });
}

test('query value, body value and method changes retain their exact digest differences', async () => {
  const variants = [input, { ...input, target: input.target.replace('ETH', 'BTC') }, { ...input, method: 'HEAD' }];
  const outputs = [];
  for (const value of variants) outputs.push((await callNormalization(server.url, value)).envelope.result);
  assert.equal(new Set(outputs.map(value => value.bindingDigest)).size, 3);
  assert.deepEqual(outputs, variants.map(value => direct(value).result));
  const a = { method: 'POST', target: 'https://seller.example/data', options: { body: { z: 2, a: 1 } } };
  const b = { ...a, options: { body: { a: 1, z: 2 } } };
  const c = { ...a, options: { body: { a: 2, z: 2 } } };
  const ra = (await callNormalization(server.url, a)).envelope;
  assert.deepEqual(ra, (await callNormalization(server.url, b)).envelope);
  assert.notEqual(ra.result.bindingDigest, (await callNormalization(server.url, c)).envelope.result.bindingDigest);
});

test('existing inspect-url CLI matches the complete SDK artifact and exact core refusal', async () => {
  const cli = new URL('../../cli.mjs', import.meta.url);
  const success = spawnSync(process.execPath, [cli.pathname, 'inspect-url', input.target], { encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(JSON.parse(success.stdout), (await callNormalization(server.url, input)).envelope.result);
  const value = { ...input, target: 'http://seller.example/data' };
  const failure = spawnSync(process.execPath, [cli.pathname, 'inspect-url', value.target], { encoding: 'utf8' });
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout, '');
  const received = (await callNormalization(server.url, value)).envelope;
  assert.deepEqual(received, direct(value));
  assert.ok(failure.stderr.includes(`${received.error.name}: ${received.error.message}`));
});

const negative = [
  ['malformed JSON', () => '{', -32700],
  ['JSON null', () => 'null', -32600],
  ['batch', () => [wire()], -32600],
  ['notification', () => { const w = wire(); delete w.id; return w; }, -32600],
  ['unknown A2A method', () => ({ ...wire(), method: 'NoSuchMethod' }), -32601],
  ['legacy message/send', () => ({ ...wire(), method: 'message/send' }), -32601],
  ['streaming', () => ({ ...wire(), method: 'SendStreamingMessage' }), -32004],
  ['task retrieval after zero retention', () => ({ ...wire(), method: 'GetTask', params: { id: 'not-retained' } }), -32001],
  ['subscription disabled', () => ({ ...wire(), method: 'SubscribeToTask', params: { id: 'not-retained' } }), -32004],
  ['extended card disabled', () => ({ ...wire(), method: 'GetExtendedAgentCard', params: {} }), -32004],
  ['push API disabled', () => ({ ...wire(), method: 'CreateTaskPushNotificationConfig', params: {} }), -32003],
  ['legacy role', () => { const w = wire(); w.params.message.role = 'user'; return w; }, -32602],
  ['missing parts', () => { const w = wire(); delete w.params.message.parts; return w; }, -32602],
  ['multiple data parts', () => { const w = wire(); w.params.message.parts.push(w.params.message.parts[0]); return w; }, -32602],
  ['ambiguous data and URL', () => { const w = wire(); w.params.message.parts[0].url = 'file:///etc/passwd'; return w; }, -32602],
  ['text JSON', () => { const w = wire(); w.params.message.parts = [{ text: JSON.stringify(input), mediaType: 'application/json' }]; return w; }, -32602],
  ['unsupported part media', () => { const w = wire(); w.params.message.parts[0].mediaType = 'text/plain'; return w; }, -32005],
  ['array input', () => wire([]), -32602],
  ['unknown input option', () => wire({ ...input, options: { filename: '/etc/passwd' } }), -32602],
  ['oversized data', () => wire({ ...input, target: `https://seller.example/?q=${'x'.repeat(MAX_DATA_BYTES)}` }), -32602],
  ['excessive depth', () => { let body = {}; for (let i = 0; i < MAX_DEPTH + 1; i++) body = { body }; return wire({ method: 'POST', target: input.target, options: { body } }); }, -32602],
  ['push notification request', () => { const w = wire(); w.params.configuration = { taskPushNotificationConfig: { url: 'https://never-resolve.invalid' } }; return w; }, -32003],
  ['async request', () => { const w = wire(); w.params.configuration = { returnImmediately: true }; return w; }, -32602],
  ['unsupported output media', () => { const w = wire(); w.params.configuration = { acceptedOutputModes: ['text/plain'] }; return w; }, -32005],
];
for (const [label, make, code] of negative) {
  test(`protocol refusal and same-process recovery: ${label}`, async () => {
    const response = await raw(make());
    assert.equal(response.status, 200);
    assert.equal(response.body.error?.code, code, JSON.stringify(response.body));
    assert.equal(response.body.result, undefined);
    await recovered();
  });
}

test('missing and unsupported A2A-Version are refused, then valid calls recover', async () => {
  for (const version of ['', '0.3', '2.0']) {
    const response = await raw(wire(), { extraHeaders: { 'a2a-version': version } });
    assert.ok(response.body.error, JSON.stringify(response));
    assert.equal(response.body.result, undefined);
    await recovered();
  }
});

test('wire size, HTTP media, compressed bodies, REST path and browser origin are refused', async () => {
  for (const [body, options, expected] of [
    [' '.repeat(MAX_WIRE_BYTES + 1), {}, 413],
    [wire(), { extraHeaders: { 'content-type': 'text/plain' } }, 415],
    [wire(), { extraHeaders: { 'content-encoding': 'gzip' } }, 415],
    [wire(), { path: '/message:send' }, 404],
    [wire(), { extraHeaders: { origin: 'https://outside.example' } }, 403],
  ]) {
    assert.equal((await raw(body, options)).status, expected);
    await recovered();
  }
});

test('untrusted URL/file/raw parts never contact a loopback sentinel', async () => {
  let hits = 0;
  const sentinel = createServer((req, res) => { hits++; res.end('must not load'); });
  await new Promise(resolve => sentinel.listen(0, '127.0.0.1', resolve));
  try {
    for (const part of [
      { url: `http://127.0.0.1:${sentinel.address().port}/`, mediaType: 'application/json' },
      { url: 'https://never-resolve.invalid/data', mediaType: 'application/json' },
      { url: 'file:///etc/passwd', mediaType: 'application/json' },
      { file: { uri: 'file:///etc/passwd' }, mediaType: 'application/json' },
      { raw: 'e30=', mediaType: 'application/json' },
    ]) {
      const w = wire(); w.params.message.parts = [part];
      assert.equal((await raw(w)).body.error.code, -32602);
      await recovered();
    }
    assert.equal(hits, 0);
  } finally { await new Promise(resolve => sentinel.close(resolve)); }
});

test('a requested history cannot echo private supplied values', async () => {
  const w = wire({ ...input, target: 'https://seller.example/?q=SYNTHETIC_PRIVATE_VALUE' });
  w.params.configuration = { historyLength: 100 };
  const response = await raw(w);
  assert.equal(response.body.result.task.history, undefined);
  assert.doesNotMatch(JSON.stringify(response), /SYNTHETIC_PRIVATE_VALUE/);
});

test('client refuses non-loopback endpoints before discovery', async () => {
  for (const url of ['https://seller.example/', 'file:///etc/passwd', 'http://localhost:1234/', 'http://127.0.0.1:1234/path']) {
    await assert.rejects(callNormalization(url, input), /loopback/);
  }
});


test('actual HTTP Host header refuses a non-loopback authority', async () => {
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(server.url, { method: 'POST', headers: { ...headers, host: 'outside.example' } }, res => {
      res.resume(); res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject); req.end(JSON.stringify(wire()));
  });
  assert.equal(response, 403);
  await recovered();
});

test('runtime traps observe no DNS, external fetch, arbitrary file read or signing', async () => {
  const attempted = [];
  const forbid = name => () => { attempted.push(name); throw new Error(`Forbidden side effect: ${name}`); };
  const originalFetch = globalThis.fetch;
  try {
    for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) mock.method(dns, name, forbid(`dns.${name}`));
    for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'writeFile', 'writeFileSync']) mock.method(fs, name, forbid(`fs.${name}`));
    for (const name of ['sign', 'createSign', 'createPrivateKey', 'generateKeyPair', 'generateKeyPairSync']) mock.method(crypto, name, forbid(`crypto.${name}`));
    syncBuiltinESMExports();
    mock.method(globalThis, 'fetch', (url, init) => {
      if (new URL(url instanceof Request ? url.url : url).origin !== new URL(server.url).origin) {
        return forbid('external fetch')();
      }
      return originalFetch(url, init);
    });
    for (const value of [
      { ...input, target: 'https://never-resolve.invalid/' },
      { ...input, target: 'file:///must-not-read' },
      { method: 'POST', target: input.target, options: { body: { url: 'https://never-resolve.invalid/', file: '/must-not-read', code: 'throw new Error("not executed")' } } },
    ]) assert.deepEqual((await callNormalization(server.url, value)).envelope, direct(value));
    for (const part of [{ url: 'file:///must-not-read' }, { url: 'https://never-resolve.invalid/' }]) {
      const w = wire(); w.params.message.parts = [part];
      assert.equal((await raw(w)).body.error.code, -32602);
    }
    assert.deepEqual(attempted, []);
  } finally { mock.restoreAll(); syncBuiltinESMExports(); }
  await recovered();
});

test('completed task inputs are not retained or listed', async () => {
  const value = { ...input, target: 'https://seller.example/data?q=SYNTHETIC_NEVER_RETAIN' };
  const received = await callNormalization(server.url, value);
  const lookup = await raw({ ...wire(), method: 'GetTask', params: { id: received.task.id } });
  assert.equal(lookup.body.error.code, -32001);
  const listed = await raw({ ...wire(), method: 'ListTasks', params: {} });
  assert.deepEqual(listed.body.result.tasks, []);
  assert.equal(listed.body.result.totalSize, 0);
  assert.doesNotMatch(JSON.stringify(listed.body), /SYNTHETIC_NEVER_RETAIN/);
  await recovered();
});
