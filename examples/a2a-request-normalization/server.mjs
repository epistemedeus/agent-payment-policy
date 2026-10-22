import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { AgentCard, Task, A2A_PROTOCOL_VERSION, AGENT_CARD_PATH } from '@a2a-js/sdk';
import {
  AgentEvent, DefaultRequestHandler, JsonRpcTransportHandler, ServerCallContext, validateVersion,
} from '@a2a-js/sdk/server';
import { ContentTypeNotSupportedError, PushNotificationNotSupportedError, UnsupportedOperationError } from '@a2a-js/sdk/errors';
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
function checkSend(params) {
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
  if (part.mediaType !== 'application/json') throw new ContentTypeNotSupportedError('Use an application/json data part');
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

function cardFor(url) {
  return AgentCard.fromJSON({
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
}

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'a2a-version': A2A_PROTOCOL_VERSION });
  res.end(JSON.stringify(body));
}
function rpcError(res, id, code, message, status = 200) {
  reply(res, status, { jsonrpc: '2.0', id, error: { code, message } });
}

export async function startServer({ port = 0 } = {}) {
  let card, transport;
  let busy = false;
  const server = createServer(async (req, res) => {
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
      validateVersion(req.headers['a2a-version'] ?? '0.3', card, 'JSONRPC');
      if (['SendStreamingMessage', 'SubscribeToTask'].includes(wire.method)) {
        throw new UnsupportedOperationError('Streaming is not supported');
      }
      if (wire.method === 'SendMessage') {
        checkSend(wire.params);
        // The protocol permits a server to apply a lower history limit. Never echo inputs.
        wire.params.configuration = { ...wire.params.configuration, historyLength: 0 };
      }
      reply(res, 200, await transport.handle(wire, new ServerCallContext({ requestedVersion: req.headers['a2a-version'] })));
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
  card = cardFor(url);
  // Single terminal task event: the SDK has no reason to load a saved task.
  // Do not retain tasks, raw messages, history, or caller metadata between requests.
  const discardStore = { async save() {}, async load() { return undefined; }, async list() { return { tasks: [], nextPageToken: '', pageSize: 0, totalSize: 0 }; } };
  transport = new JsonRpcTransportHandler(new DefaultRequestHandler(card, discardStore, new NormalizationExecutor()));
  return { url, async stop() {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections(); await closed;
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const instance = await startServer();
  console.log(JSON.stringify({ url: instance.url, card: `${instance.url}${AGENT_CARD_PATH}` }));
  const stop = async () => { await instance.stop(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
