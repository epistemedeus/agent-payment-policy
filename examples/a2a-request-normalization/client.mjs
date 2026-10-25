import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Role, TaskState } from '@a2a-js/sdk';
import { ClientFactory, DefaultAgentCardResolver, JsonRpcTransportFactory } from '@a2a-js/sdk/client';

function localUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use the explicit http://127.0.0.1:<port>/ loopback server URL');
  }
  return url;
}

export async function callNormalization(baseUrl, input, { protocolVersion = '1.0' } = {}) {
  if (!['1.0', '0.3'].includes(protocolVersion)) throw new Error('Choose protocolVersion 1.0 or 0.3 explicitly');
  const base = localUrl(baseUrl);
  // Constrain discovery, advertised interfaces, and redirects to the same loopback origin.
  const localFetch = (url, init) => {
    const target = new URL(url instanceof Request ? url.url : url);
    if (target.origin !== base.origin) throw new Error('Agent endpoint left the loopback origin');
    return fetch(url, { ...init, redirect: 'error', signal: init?.signal ?? AbortSignal.timeout(5000) });
  };
  const resolver = new DefaultAgentCardResolver({ fetchImpl: localFetch });
  const card = await resolver.resolve(base.href);
  const factory = new ClientFactory({
    cardResolver: resolver,
    transports: [new JsonRpcTransportFactory({ fetchImpl: localFetch, legacyCompat: { enabled: protocolVersion === '0.3' } })],
    preferredTransports: ['JSONRPC'],
  });
  const selectedCard = protocolVersion === '1.0' ? card : {
    ...card, supportedInterfaces: card.supportedInterfaces.filter(iface => iface.protocolVersion === protocolVersion),
  };
  if (!selectedCard.supportedInterfaces.length) throw new Error('Agent does not advertise the requested protocol version');
  const client = await factory.createFromAgentCard(selectedCard);
  const task = await client.sendMessage({
    message: {
      messageId: randomUUID(), role: Role.ROLE_USER,
      parts: [{ content: { $case: 'data', value: input }, mediaType: 'application/json' }],
    },
    configuration: { acceptedOutputModes: ['application/json'], historyLength: 0, returnImmediately: false },
  }, { signal: AbortSignal.timeout(5000) });
  if (!('artifacts' in task) || ![TaskState.TASK_STATE_COMPLETED, TaskState.TASK_STATE_REJECTED].includes(task.status?.state) ||
      task.artifacts.length !== 1 || task.artifacts[0].parts.length !== 1 ||
      task.artifacts[0].parts[0].content?.$case !== 'data') {
    throw new Error('Expected a terminal task with one structured normalization artifact');
  }
  return { card, task, envelope: task.artifacts[0].parts[0].content.value };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A supplied JSON value, never a filename or remote request URI to load.
  const input = JSON.parse(process.argv[3] ?? '{"method":"GET","target":"https://seller.example/data?asset=ETH"}');
  const result = await callNormalization(process.argv[2], input, { protocolVersion: process.argv[4] === '--legacy-0.3' ? '0.3' : '1.0' });
  console.log(JSON.stringify(result, null, 2));
}
