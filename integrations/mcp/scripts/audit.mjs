import { appendFileSync } from 'node:fs';
if (process.env.MCP_PROCESS_AUDIT) {
  appendFileSync(process.env.MCP_PROCESS_AUDIT, JSON.stringify({ pid: process.pid, ppid: process.ppid, event: 'start', at: Date.now() }) + '\n');
  process.on('exit', code => appendFileSync(process.env.MCP_PROCESS_AUDIT, JSON.stringify({ pid: process.pid, event: 'exit', code, at: Date.now() }) + '\n'));
}
