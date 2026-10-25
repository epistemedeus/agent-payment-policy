import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { AgentCard, Task, SendMessageRequest, A2A_PROTOCOL_VERSION, AGENT_CARD_PATH } from '@a2a-js/sdk';
import { duplicateInterfacesForLegacy, isLegacyJsonRpcMethod, isV1JsonRpcMethod } from '@a2a-js/sdk/compat/v0_3';
import { LegacyJsonRpcTransportHandler } from '@a2a-js/sdk/compat/v0_3/server';
import {
  AgentEvent, DefaultRequestHandler, JsonRpcTransportHandler, ServerCallContext, validateVersion,
} from '@a2a-js/sdk/server';
import { ContentTypeNotSupportedError, PushNotificationNotSupportedError, UnsupportedOperationError, RequestMalformedError } from '@a2a-js/sdk/errors';
import { normalizeRequest } from '../../core.mjs';

export const MAX_WIRE_BYTES = 64 * 1024;
export const MAX_DATA_BYTES = 16 * 1024;
export const MAX_DEPTH = 32;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const bad = message => Object.assign(new Error(message), { rpcCode: -32602 });

function bounded(value) {
  const pending = [[value, 0]];
  while (pending.length) {
    const [item, depth] = pending.pop();
    if (depth > MAX_DEPTH) throw bad('JSON nesting exceeds example limit');
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) pending.push([child, depth + 1]);
    }
  }
}

// Validate the narrow skill envelope, never reimplement core URL/body validation.
function checkSend(params, legacyDecoded = false) {
  if (!object(params) || !only(params, ['message', 'configuration', 'metadata', 'tenant']) || params.tenant) {
    throw bad('Only a new, single-turn normalization request is supported');
  }
  const message = params.message;
  if (!object(message) || message.role !== 'ROLE_USER' ||
      typeof message.messageId !== 'string' || !message.messageId.trim() || message.messageId.length > 128 ||
      message.taskId || message.referenceTaskIds?.length || message.extensions?.length) {
    throw bad('A new ROLE_USER message with messageId is required');
  }
  if (!Array.isArray(message.parts) || message.parts.length !== 1) {
    throw bad('Exactly one structured data part is required');
  }
  const part = message.parts[0];
  // Check before SDK oneof decoding, which would otherwise choose one ambiguous field.
  if (!object(part) || !only(part, ['data', 'mediaType']) || !Object.hasOwn(part, 'data')) {
    throw bad('Only one application/json data part is supported; text, URL and file parts are refused');
  }
  // The official v0.3 codec represents JSON DataPart without a mediaType field.
  if (legacyDecoded ? part.mediaType !== undefined : part.mediaType !== 'application/json') {
    throw new ContentTypeNotSupportedError('Use an application/json data part');
  }
  const input = part.data;
  if (!object(input) || !only(input, ['method', 'target', 'options']) ||
      typeof input.target !== 'string' || (input.method !== undefined && typeof input.method !== 'string') ||
      (input.options !== undefined && (!object(input.options) || !only(input.options, ['body', 'mediaType'])))) {
    throw bad('Data must be { method?, target, options?: { body?, mediaType? } }');
  }
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_DATA_BYTES) throw bad('Data exceeds example limit');
  bounded(input);
  const config = params.configuration;
  if (config !== undefined && !object(config)) throw bad('Configuration must be an object');
  if (config?.taskPushNotificationConfig) throw new PushNotificationNotSupportedError();
  if (config?.returnImmediately) throw bad('Only blocking requests are supported');
  if (config?.acceptedOutputModes !== undefined && (!Array.isArray(config.acceptedOutputModes) ||
      !config.acceptedOutputModes.includes('application/json'))) {
    throw new ContentTypeNotSupportedError('Only application/json output is supported');
  }
}

// Guard fields the official decoder would discard or coerce. This validates the
// example's envelope; translation and serialization remain entirely in the SDK.
function checkLegacySend(params) {
  if (!object(params) || !only(params, ['message', 'configuration', 'metadata'])) throw bad('Invalid legacy send parameters');
  const message = params.message;
  if (!object(message) || !only(message, ['kind', 'role', 'messageId', 'parts', 'contextId', 'taskId', 'referenceTaskIds', 'extensions', 'metadata']) ||
      message.kind !== 'message' || message.role !== 'user') throw bad('A new legacy user message is required');
  if (!Array.isArray(message.parts) || message.parts.length !== 1 ||
      !object(message.parts[0]) || !only(message.parts[0], ['kind', 'data']) ||
      message.parts[0].kind !== 'data' || !object(message.parts[0].data)) {
    throw bad('Exactly one legacy JSON data part is required; metadata, text and files are refused');
  }
  const config = params.configuration;
  if (config !== undefined && (!object(config) || !only(config, ['blocking', 'acceptedOutputModes', 'historyLength', 'pushNotificationConfig']))) {
    throw bad('Invalid legacy configuration');
  }
  if (config?.pushNotificationConfig !== undefined) throw new PushNotificationNotSupportedError();
  if (config && config.blocking !== true) throw bad('Legacy configuration requires blocking: true');
  if (message.contextId !== undefined && (typeof message.contextId !== 'string' || message.contextId.length > 128)) throw bad('Invalid contextId');
  for (const metadata of [params.metadata, message.metadata]) {
    if (metadata !== undefined) {
      if (!object(metadata)) throw bad('Metadata must be an object');
      bounded(metadata);
    }
  }
  if (config?.acceptedOutputModes !== undefined && (!Array.isArray(config.acceptedOutputModes) ||
      config.acceptedOutputModes.some(mode => typeof mode !== 'string'))) throw bad('Output modes must be strings');
  if (config?.acceptedOutputModes !== undefined && !config.acceptedOutputModes.includes('application/json')) {
    throw new ContentTypeNotSupportedError('Only application/json output is supported');
  }
  if (config?.historyLength !== undefined && (!Number.isSafeInteger(config.historyLength) || config.historyLength < 0)) throw bad('Invalid historyLength');
  // Reject malformed references before codec normalization can hide them.
  for (const key of ['referenceTaskIds', 'extensions']) {
    if (message[key] !== undefined && (!Array.isArray(message[key]) || message[key].length)) throw bad('Task references and extensions are unsupported');
  }
  if (message.taskId !== undefined) throw bad('Task references are unsupported');
}

class NormalizationExecutor {
  async execute(context, bus) {
    const input = context.userMessage.parts[0].content.value;
    let envelope;
    try {
      envelope = { ok: true, result: normalizeRequest(input.method, input.target, input.options) };
    } catch (error) {
      // Preserve the complete core refusal name/message, without a host-specific stack.
      envelope = { ok: false, error: { name: error.name, message: error.message } };
    }
    bus.publish(AgentEvent.task(Task.fromJSON({
      id: context.taskId, contextId: context.contextId,
      status: { state: envelope.ok ? 'TASK_STATE_COMPLETED' : 'TASK_STATE_REJECTED' },
      artifacts: [{
        artifactId: 'normalization', name: 'Request normalization result',
        description: 'Exact core result or refusal; no authorization or payment decision.',
        parts: [{ mediaType: 'application/json', data: envelope }],
      }],
    })));
  }
  async cancelTask() { throw bad('Single-turn normalization cannot be canceled'); }
}

function cardFor(url, legacyCompat) {
  const card = AgentCard.fromJSON({
    name: 'Offline request normalization example', version: '1.0.0',
    description: 'Deterministic normalization and request binding using agent-payment-policy. Supplied targets are never fetched. No authorization, SSRF safety, settlement or payment acceptance claim.',
    supportedInterfaces: [{ url, protocolBinding: 'JSONRPC', protocolVersion: A2A_PROTOCOL_VERSION }],
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    defaultInputModes: ['application/json'], defaultOutputModes: ['application/json'],
    skills: [{
      id: 'normalize-request', name: 'Normalize a supplied request',
      description: 'One JSON data part: {method?, target, options?: {body?, mediaType?}}. Binds query/body/method through unchanged normalizeRequest. At most 16 KiB data and depth 32. Single-turn, blocking; no task retrieval or retained history.',
      tags: ['normalization', 'request-binding', 'offline'],
      inputModes: ['application/json'], outputModes: ['application/json'],
    }],
  });
  if (legacyCompat) card.supportedInterfaces = duplicateInterfacesForLegacy(card.supportedInterfaces, ['JSONRPC']);
  return card;
}

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'a2a-version': res.getHeader('a2a-version') ?? A2A_PROTOCOL_VERSION });
  res.end(JSON.stringify(body));
}
function rpcError(res, id, code, message, status = 200) {
  reply(res, status, { jsonrpc: '2.0', id, error: { code, message } });
}

export async function startServer({ port = 0, legacyCompat = false } = {}) {
  if (typeof legacyCompat !== 'boolean') throw new TypeError('legacyCompat must be a boolean');
  let card, transport, legacyTransport;
  let busy = false;
  const server = createServer(async (req, res) => {
    const requestedVersion = req.headers['a2a-version'] ?? '0.3';
    if (legacyCompat && requestedVersion === '0.3' && req.method === 'POST') res.setHeader('a2a-version', '0.3');
    // This is a local experiment, including protection against browser-origin calls.
    if (req.headers.origin || req.headers.host !== new URL(card.supportedInterfaces[0].url).host) {
      req.resume(); return reply(res, 403, { error: 'Loopback origin required' });
    }
    if (req.method === 'GET' && req.url === `/${AGENT_CARD_PATH}`) {
      return reply(res, 200, AgentCard.toJSON(card));
    }
    if (req.method !== 'POST' || req.url !== '/') {
      req.resume(); return reply(res, 404, { error: 'Only the card and JSON-RPC root are available' });
    }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '') || req.headers['content-encoding']) {
      req.resume(); return reply(res, 415, { error: 'Use uncompressed application/json' });
    }
    if (busy) { req.resume(); return reply(res, 429, { error: 'One request at a time' }); }
    busy = true;
    let id = null;
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_WIRE_BYTES) {
          req.resume(); return rpcError(res, null, -32602, 'Wire body exceeds example limit', 413);
        }
        chunks.push(chunk);
      }
      let wire;
      try { wire = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { return rpcError(res, null, -32700, 'Invalid JSON or UTF-8'); }
      if (!object(wire) || wire.jsonrpc !== '2.0' || typeof wire.method !== 'string' ||
          !(['string', 'number'].includes(typeof wire.id)) ||
          (typeof wire.id === 'number' && !Number.isSafeInteger(wire.id))) {
        return rpcError(res, null, -32600, 'A single JSON-RPC 2.0 request with id is required');
      }
      id = wire.id;
      validateVersion(requestedVersion, card, 'JSONRPC');
      const legacy = legacyCompat && requestedVersion === '0.3';
      if (legacyCompat && ((legacy && isV1JsonRpcMethod(wire.method)) || (!legacy && isLegacyJsonRpcMethod(wire.method)))) {
        throw bad('A2A version and method disagree');
      }
      if (['SendStreamingMessage', 'SubscribeToTask', ...(legacy ? ['message/stream', 'tasks/resubscribe'] : [])].includes(wire.method)) {
        throw new UnsupportedOperationError('Streaming is not supported');
      }
      if (wire.method === 'SendMessage') {
        checkSend(wire.params);
        // The protocol permits a server to apply a lower history limit. Never echo inputs.
        wire.params.configuration = { ...wire.params.configuration, historyLength: 0 };
      }
      if (legacy && wire.method === 'message/send') checkLegacySend(wire.params);
      reply(res, 200, await (legacy ? legacyTransport : transport).handle(wire, new ServerCallContext({ requestedVersion: req.headers['a2a-version'] })));
    } catch (error) {
      const mapped = error.rpcCode ? { code: error.rpcCode, message: error.message } : JsonRpcTransportHandler.mapToJSONRPCError(error);
      rpcError(res, id, mapped.code, mapped.message);
    } finally { busy = false; }
  });
  server.maxConnections = 4;
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.timeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  card = cardFor(url, legacyCompat);
  // Single terminal task event: the SDK has no reason to load a saved task.
  // Do not retain tasks, raw messages, history, or caller metadata between requests.
  const discardStore = { async save() {}, async load() { return undefined; }, async list() { return { tasks: [], nextPageToken: '', pageSize: 0, totalSize: 0 }; } };
  const handler = new DefaultRequestHandler(card, discardStore, new NormalizationExecutor());
  transport = new JsonRpcTransportHandler(handler);
  if (legacyCompat) {
    const guarded = new Proxy(handler, { get(target, key) {
      if (key === 'sendMessage') return async (request, context) => {
        // Receive the official native decoded shape, then share every skill
        // check with 1.0 before the executor can run. No private codec imports.
        try { checkSend(SendMessageRequest.toJSON(request), true); }
        catch (error) {
          // Inside the SDK handler use its semantic error class, so its own
          // legacy mapper preserves invalid-params rather than internal-error.
          if (error.rpcCode) throw new RequestMalformedError(error.message);
          throw error;
        }
        request.configuration = { ...request.configuration, historyLength: 0 };
        return target.sendMessage(request, context);
      };
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    legacyTransport = new LegacyJsonRpcTransportHandler(guarded);
  }
  return { url, async stop() {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections(); await closed;
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const instance = await startServer({ legacyCompat: process.argv.includes('--legacy-0.3') });
  console.log(JSON.stringify({ url: instance.url, card: `${instance.url}${AGENT_CARD_PATH}` }));
  const stop = async () => { await instance.stop(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
