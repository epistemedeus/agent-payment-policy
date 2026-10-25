import assert from 'node:assert/strict';
import { after, before, test, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { TaskState } from '@a2a-js/sdk';
import { LegacyJsonRpcTransport } from '@a2a-js/sdk/compat/v0_3/client';
import { normalizeRequest } from '../../core.mjs';
import { startServer, MAX_DATA_BYTES, MAX_WIRE_BYTES, MAX_DEPTH } from './server.mjs';
import { callNormalization } from './client.mjs';

let strict, compat;
before(async () => { strict = await startServer(); compat = await startServer({ legacyCompat: true }); });
after(async () => { await strict?.stop(); await compat?.stop(); });
const get = { method: 'GET', target: 'https://seller.example/data?asset=ETH&window=5m' };
const post = { method: 'POST', target: 'https://seller.example/analyze?mode=fast', options: { body: { types: ['A', 'MX'], domain: 'buyer.example' }, mediaType: 'application/json' } };
const refusal = { method: 'GET', target: 'http://seller.example/data' };
function direct(value) {
  try { return { ok: true, result: normalizeRequest(value.method, value.target, value.options) }; }
  catch (error) { return { ok: false, error: { name: error.name, message: error.message } }; }
}
// Synthetic payloads from the official v0.3 schema, not captured platform bodies.
function legacy(value = get) {
  return { jsonrpc: '2.0', id: randomUUID(), method: 'message/send', params: {
    message: { kind: 'message', role: 'user', messageId: randomUUID(), parts: [{ kind: 'data', data: value }] },
    configuration: { blocking: true, acceptedOutputModes: ['application/json'], historyLength: 0 },
  } };
}
function modern(value = get) {
  return { jsonrpc: '2.0', id: randomUUID(), method: 'SendMessage', params: {
    message: { role: 'ROLE_USER', messageId: randomUUID(), parts: [{ data: value, mediaType: 'application/json' }] },
  } };
}
async function raw(server, body, { version, path = '/', headers = {} } = {}) {
  const response = await fetch(new URL(path, server.url), {
    method: 'POST', headers: { 'content-type': 'application/json', ...(version === undefined ? {} : { 'a2a-version': version }), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.json() };
}
async function recovered(server = compat) {
  for (const protocolVersion of server === strict ? ['1.0'] : ['0.3', '1.0']) {
    assert.deepEqual((await callNormalization(server.url, post, { protocolVersion })).envelope, direct(post));
  }
}

test('opt-in adds only the official 0.3 JSONRPC mirror; default card remains scoped to 1.0', async () => {
  const a = await (await fetch(`${strict.url}.well-known/agent-card.json`)).json();
  const b = await (await fetch(`${compat.url}.well-known/agent-card.json`)).json();
  assert.deepEqual(a.supportedInterfaces, [{ url: strict.url, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]);
  assert.deepEqual(b.supportedInterfaces, ['1.0', '0.3'].map(protocolVersion => ({ url: compat.url, protocolBinding: 'JSONRPC', protocolVersion })));
  delete a.supportedInterfaces; delete b.supportedInterfaces;
  assert.deepEqual(a, b);
});

for (const [label, input] of [
  ['GET query', get], ['POST body', post], ['core refusal', refusal],
  ['default method', { target: 'https://SELLER.example:443/a/../data?z=2&a=1&a=2#f' }],
  ['unknown HTTP method', { ...get, method: 'BREW' }],
  ['invalid method', { ...get, method: '??' }],
  ['body on GET', { ...get, options: { body: {} } }],
  ['missing POST body', { method: 'POST', target: get.target }],
  ['unsupported body media', { ...post, options: { body: {}, mediaType: 'text/plain' } }],
  ['credential query', { ...get, target: 'https://seller.example/?api_key=SYNTHETIC' }],
  ['private IP', { ...get, target: 'https://127.0.0.1/data' }],
  ['unresolvable target without DNS', { ...get, target: 'https://never-resolve.invalid/data' }],
]) {
  test(`complete cross-version SDK artifacts and raw headerless legacy: ${label}`, async () => {
    const expected = direct(input);
    for (const protocolVersion of ['1.0', '0.3']) {
      const received = await callNormalization(compat.url, input, { protocolVersion });
      assert.deepEqual(received.envelope, expected);
      assert.equal(received.task.status.state, expected.ok ? TaskState.TASK_STATE_COMPLETED : TaskState.TASK_STATE_REJECTED);
      assert.deepEqual(received.task.history, []);
    }
    const response = await raw(compat, legacy(input));
    assert.equal(response.headers['a2a-version'], '0.3');
    assert.equal(response.body.result.kind, 'task');
    assert.deepEqual(response.body.result.artifacts[0].parts, [{ kind: 'data', data: expected }]);
    assert.equal(response.body.result.status.state, expected.ok ? 'completed' : 'rejected');
    assert.equal(response.body.result.history, undefined);
    if (!expected.ok) await recovered();
  });
}

for (const [label, serverName, wire, version, expected] of [
  ['default headerless legacy', 'strict', legacy, undefined, -32009],
  ['default explicit legacy', 'strict', legacy, '0.3', -32009],
  ['default headerless modern', 'strict', modern, undefined, -32009],
  ['default legacy with modern header', 'strict', legacy, '1.0', -32601],
  ['opt-in modern with legacy header', 'compat', modern, '0.3', -32602],
  ['opt-in headerless modern', 'compat', modern, undefined, -32602],
  ['opt-in legacy with modern header', 'compat', legacy, '1.0', -32602],
  ...['', '0.2', '0.4', '0.3.0', '1.1', '2.0', 'nonsense'].flatMap(version =>
    ['strict', 'compat'].map(server => [`${server} unsupported ${JSON.stringify(version)}`, server, legacy, version, -32009])),
]) {
  test(`version boundary: ${label}`, async () => {
    const server = serverName === 'strict' ? strict : compat;
    const response = await raw(server, wire(), { version });
    assert.equal(response.body.error?.code, expected, JSON.stringify(response));
    assert.equal(response.body.result, undefined);
    await recovered(server);
  });
}

const negative = [
  ['missing params', w => { delete w.params; }],
  ['legacy role disagreement', w => { w.params.message.role = 'ROLE_USER'; }],
  ['wrong kind', w => { w.params.message.kind = 'task'; }],
  ['blank messageId', w => { w.params.message.messageId = ' '; }],
  ['long messageId', w => { w.params.message.messageId = 'x'.repeat(129); }],
  ['numeric messageId', w => { w.params.message.messageId = 1; }],
  ['missing parts', w => { delete w.params.message.parts; }],
  ['multiple parts', w => { w.params.message.parts.push(w.params.message.parts[0]); }],
  ['ambiguous text', w => { w.params.message.parts[0].text = '{}'; }],
  ['ambiguous URL', w => { w.params.message.parts[0].url = 'file:///etc/passwd'; }],
  ['file', w => { w.params.message.parts = [{ kind: 'file', file: { uri: 'file:///etc/passwd', mimeType: 'application/json' } }]; }],
  ['text', w => { w.params.message.parts = [{ kind: 'text', text: JSON.stringify(get) }]; }],
  ['raw', w => { w.params.message.parts = [{ raw: 'e30=' }]; }],
  ['unsupported media field', w => { w.params.message.parts[0].mediaType = 'text/plain'; }],
  ['codec unwrap metadata', w => { w.params.message.parts[0] = { kind: 'data', data: { value: get }, metadata: { data_part_compat: true } }; }],
  ['array skill', w => { w.params.message.parts[0].data = []; }],
  ['null skill', w => { w.params.message.parts[0].data = null; }],
  ['unknown skill', w => { w.params.message.parts[0].data = { ...get, skill: 'other' }; }],
  ['unknown options', w => { w.params.message.parts[0].data = { ...get, options: { filename: '/etc/passwd' } }; }],
  ['taskId', w => { w.params.message.taskId = 'old-task'; }],
  ['task references', w => { w.params.message.referenceTaskIds = ['old-task']; }],
  ['malformed references', w => { w.params.message.referenceTaskIds = {}; }],
  ['extension', w => { w.params.message.extensions = ['other-skill']; }],
  ['tenant', w => { w.params.tenant = 'other'; }],
  ['nonblocking', w => { w.params.configuration.blocking = false; }],
  ['nonboolean blocking', w => { w.params.configuration.blocking = 'true'; }],
  ['missing blocking in config', w => { delete w.params.configuration.blocking; }],
  ['modern config fields', w => { w.params.configuration.returnImmediately = false; }],
  ['push', w => { w.params.configuration.pushNotificationConfig = { url: 'https://never-resolve.invalid/' }; }, -32003],
  ['output media', w => { w.params.configuration.acceptedOutputModes = ['text/plain']; }, -32005],
  ['empty output modes before codec omission', w => { w.params.configuration.acceptedOutputModes = []; }, -32005],
  ['malformed output modes', w => { w.params.configuration.acceptedOutputModes = 'application/json'; }],
  ['malformed history', w => { w.params.configuration.historyLength = '100'; }],
  ['malformed contextId', w => { w.params.message.contextId = {}; }],
  ['malformed metadata', w => { w.params.metadata = []; }],
  ['deep metadata', w => { let data = {}; for (let i = 0; i < MAX_DEPTH + 1; i++) data = { data }; w.params.message.metadata = data; }],
  ['data size', w => { w.params.message.parts[0].data = { ...get, target: 'x'.repeat(MAX_DATA_BYTES) }; }],
  ['depth', w => { let body = {}; for (let i = 0; i < MAX_DEPTH + 1; i++) body = { body }; w.params.message.parts[0].data = { ...post, options: { body } }; }],
];
for (const [label, mutate, code = -32602] of negative) {
  test(`legacy validation before execution and useful recovery: ${label}`, async () => {
    const w = legacy(); mutate(w);
    const response = await raw(compat, w);
    assert.equal(response.body.error?.code, code, JSON.stringify(response));
    assert.equal(response.body.result, undefined);
    await recovered();
  });
}

test('legacy HTTP and parse bounds recover on both versions', async () => {
  for (const [body, options, status, code] of [
    ['{', {}, 200, -32700], ['null', {}, 200, -32600], [[legacy()], {}, 200, -32600],
    [{ ...legacy(), id: null }, {}, 200, -32600],
    [' '.repeat(MAX_WIRE_BYTES + 1), {}, 413, -32602],
    [legacy(), { headers: { 'content-type': 'text/plain' } }, 415],
    [legacy(), { headers: { 'content-encoding': 'gzip' } }, 415],
    [legacy(), { path: '/message:send' }, 404],
    [legacy(), { path: '/?query=1' }, 404],
    [legacy(), { headers: { origin: 'https://outside.example' } }, 403],
  ]) {
    const response = await raw(compat, body, options);
    assert.equal(response.status, status);
    if (code) assert.equal(response.body.error?.code, code);
    await recovered();
  }
  // fetch owns Host; use Node's HTTP client to send the actual hostile header.
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(compat.url, { method: 'POST', headers: { 'content-type': 'application/json', host: 'outside.example' } }, res => {
      res.resume(); res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject); req.end(JSON.stringify(legacy()));
  });
  assert.equal(hostileHostStatus, 403);
  await recovered();
});

test('legacy disabled operations, missing tasks and unknown methods remain refused', async () => {
  for (const [method, params, code] of [
    ['message/stream', legacy().params, -32004], ['tasks/resubscribe', { id: 'absent' }, -32004],
    ['tasks/get', { id: 'absent' }, -32001], ['tasks/cancel', { id: 'absent' }, -32001],
    ['agent/getAuthenticatedExtendedCard', {}, -32004],
    ['tasks/pushNotificationConfig/set', { taskId: 'absent', pushNotificationConfig: { url: 'https://never-resolve.invalid/' } }, -32003],
    ['NoSuchMethod', {}, -32601], ['tasks/list', {}, -32601],
  ]) {
    const response = await raw(compat, { ...legacy(), method, params });
    assert.equal(response.body.error?.code, code, JSON.stringify(response));
    await recovered();
  }
});

test('legacy zero history, no cross-version task retention and no saved client mutation', async () => {
  const w = legacy({ ...get, target: 'https://seller.example/?q=SYNTHETIC_PRIVATE' });
  w.params.configuration.historyLength = 100;
  const a = await raw(compat, w);
  assert.equal(a.body.result.history, undefined);
  assert.doesNotMatch(JSON.stringify(a), /SYNTHETIC_PRIVATE/);
  const id = a.body.result.id;
  assert.equal((await raw(compat, { ...legacy(), method: 'tasks/get', params: { id } })).body.error.code, -32001);
  assert.equal((await raw(compat, { ...modern(), method: 'GetTask', params: { id } }, { version: '1.0' })).body.error.code, -32001);
  const listed = await raw(compat, { ...modern(), method: 'ListTasks', params: {} }, { version: '1.0' });
  assert.deepEqual(listed.body.result.tasks, []);
  assert.equal(listed.body.result.totalSize, 0);
  const b = await callNormalization(compat.url, post);
  assert.notEqual(b.task.id, id);
  assert.notEqual(b.task.contextId, a.body.result.contextId);
  assert.deepEqual(b.card.supportedInterfaces.map(x => x.protocolVersion), ['1.0', '0.3']);
  await assert.rejects(callNormalization(strict.url, get, { protocolVersion: '0.3' }), /does not advertise/);
  await assert.rejects(callNormalization(compat.url, get, { protocolVersion: '2.0' }), /explicitly/);
  const transport = new LegacyJsonRpcTransport({ endpoint: compat.url });
  await assert.rejects(transport.listTasks({}), /tasks\/list/);
});

test('overlap receives 429 and clean close/restart retains no task', async () => {
  const s = await startServer({ legacyCompat: true });
  let req, closed = false;
  try {
    // An incomplete owned HTTP body holds the one-request slot deterministically.
    const response = new Promise((resolve, reject) => {
      req = httpRequest(s.url, { method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
        let body = ''; res.on('data', x => { body += x; });
        res.on('end', () => resolve(JSON.parse(body)));
      });
      req.on('error', reject);
    });
    req.write('{');
    // Wait for the incomplete request to acquire the slot using the observable
    // 429 boundary, without a timing-only assumption about server scheduling.
    let overlap;
    for (let i = 0; i < 20; i++) {
      overlap = await raw(s, legacy());
      if (overlap.status === 429) break;
    }
    assert.equal(overlap.status, 429);
    req.end();
    assert.equal((await response).error.code, -32700);
    await recovered(s);
    const completed = await raw(s, legacy());
    const oldUrl = s.url;
    await s.stop();
    closed = true;
    await assert.rejects(fetch(oldUrl, { signal: AbortSignal.timeout(1000) }));
    const restarted = await startServer({ port: Number(new URL(oldUrl).port), legacyCompat: true });
    try {
      const lookup = await raw(restarted, { ...legacy(), method: 'tasks/get', params: { id: completed.body.result.id } });
      assert.equal(lookup.body.error.code, -32001);
      await recovered(restarted);
    } finally { await restarted.stop(); }
  } finally { req?.destroy(); if (!closed) await s.stop(); }
});

test('legacy runtime paths never resolve/fetch targets, read files, sign or pay', async () => {
  let hits = 0;
  const sentinel = createServer((req, res) => { hits++; res.end('must not load'); });
  await new Promise(resolve => sentinel.listen(0, '127.0.0.1', resolve));
  const attempted = [];
  const forbid = name => () => { attempted.push(name); throw new Error(name); };
  const originalFetch = globalThis.fetch;
  try {
    for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) mock.method(dns, name, forbid(`dns.${name}`));
    for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'writeFile', 'writeFileSync']) mock.method(fs, name, forbid(`fs.${name}`));
    for (const name of ['sign', 'createSign', 'createPrivateKey', 'generateKeyPair', 'generateKeyPairSync']) mock.method(crypto, name, forbid(`crypto.${name}`));
    syncBuiltinESMExports();
    mock.method(globalThis, 'fetch', (url, init) => {
      if (new URL(url instanceof Request ? url.url : url).origin !== new URL(compat.url).origin) return forbid('external fetch')();
      return originalFetch(url, init);
    });
    for (const input of [get, refusal, post, { ...post, options: { body: { url: 'https://never-resolve.invalid/', file: '/must-not-read', code: 'throw 1' } } }]) {
      assert.deepEqual((await callNormalization(compat.url, input, { protocolVersion: '0.3' })).envelope, direct(input));
    }
    for (const part of [
      { kind: 'file', file: { uri: `http://127.0.0.1:${sentinel.address().port}/` } },
      { kind: 'file', file: { uri: 'file:///must-not-read' } },
      { kind: 'data', data: get, url: 'https://never-resolve.invalid/' },
    ]) {
      const w = legacy(); w.params.message.parts = [part];
      assert.equal((await raw(compat, w)).body.error.code, -32602);
    }
    assert.deepEqual(attempted, []);
    assert.equal(hits, 0);
  } finally {
    mock.restoreAll(); syncBuiltinESMExports();
    await new Promise(resolve => sentinel.close(resolve));
  }
  await recovered();
});
