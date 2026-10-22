#!/usr/bin/env node
if (Number(process.versions.node.split('.')[0]) < 22) {
  process.stderr.write('agent-payment-policy-mcp requires Node.js >=22.\n');
  process.exit(1);
}
await import('../src/server.mjs');
