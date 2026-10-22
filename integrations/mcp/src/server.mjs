import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { tools } from './tools/index.mjs';
import { runBounded, stopWorkers } from './isolate.mjs';
import { LIMITS } from './limits.mjs';

const codes = new Set(['ARGUMENT_LIMIT', 'POLICY_REFUSAL', 'WORK_LIMIT', 'CANCELLED', 'BUSY', 'OUTPUT_LIMIT']);
function failure(code) {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: {
    code, message: 'The supplied tool request was refused or could not complete within its bounds.',
  } }) }] };
}

const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: LIMITS.wireBytes });
const closeTransport = transport.close.bind(transport);
let transportClosing = false;
transport.close = async () => {
  if (transportClosing) return;
  transportClosing = true;
  await closeTransport();
  await stopWorkers();
  // A limit-triggered close can precede stdin EOF. Release this process-owned
  // pipe, rather than leaving a paused open handle waiting on the caller.
  process.stdin.destroy();
};
const send = transport.send.bind(transport);
transport.send = async (message, options) => {
  // SDK validation/dispatch errors may include caller field names. Do not echo them.
  if (message.error) {
    const data = message.error.code === -32022 ? {
      supported: ['2026-07-28'],
      requested: /^\d{4}-\d{2}-\d{2}$/.test(message.error.data?.requested ?? '') ? message.error.data.requested : 'unknown',
    } : undefined;
    message = { ...message, error: { code: message.error.code, message: 'MCP request refused.', ...(data ? { data } : {}) } };
  }
  if (message.result?.isError) {
    let code;
    try { code = JSON.parse(message.result.content?.[0]?.text).error.code; } catch { /* SDK-owned validation error */ }
    const { structuredContent, ...envelope } = message.result;
    message = { ...message, result: { ...envelope, ...failure(codes.has(code) ? code : 'INVALID_ARGUMENTS') } };
  }
  return send(message, options);
};
let diagnostics = 0;
const diagnostic = () => { if (diagnostics++ < 4) process.stderr.write('MCP input or transport error.\n'); };
const handle = serveStdio(() => {
  const server = new McpServer({ name: 'agent-payment-policy-mcp', version: '0.1.0' });
  for (const tool of tools) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: fromJsonSchema(tool.inputSchema),
      outputSchema: fromJsonSchema(tool.outputSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (args, context) => {
      try {
        const value = await runBounded(tool.name, args, context.mcpReq.signal);
        return { structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value) }] };
      } catch (error) {
        return failure(codes.has(error.message) ? error.message : 'INTERNAL_ERROR');
      }
    });
  }
  server.server.onclose = () => { void stopWorkers(); };
  return server;
}, { legacy: 'reject', transport, onerror: diagnostic });

async function shutdown() { await stopWorkers(); await handle.close(); }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown(); });
