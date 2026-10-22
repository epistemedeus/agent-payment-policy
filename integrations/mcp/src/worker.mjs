import { parentPort, workerData } from 'node:worker_threads';
import { tools } from './tools/index.mjs';
try {
  const tool = tools.find(candidate => candidate.name === workerData.name);
  if (!tool) throw new Error('unknown tool');
  parentPort.postMessage({ ok: true, value: tool.run(workerData.args) });
} catch {
  parentPort.postMessage({ ok: false, code: 'POLICY_REFUSAL' });
} finally {
  parentPort.close();
}
