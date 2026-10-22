import { Worker } from 'node:worker_threads';
import { LIMITS, checkArguments } from './limits.mjs';

const active = new Set();
let completion = Promise.resolve();
let queued = false;
export async function stopWorkers() {
  await Promise.all([...active].map(worker => worker.terminate()));
}

export async function runBounded(name, args, signal) {
  checkArguments(args);
  if (signal?.aborted) throw new Error('CANCELLED');
  // One bounded successor can wait for cancellation/termination to finish.
  // Further concurrent requests are refused rather than forming an unbounded queue.
  if (active.size) {
    if (queued) throw new Error('BUSY');
    queued = true;
    try { await completion; } finally { queued = false; }
    if (signal?.aborted) throw new Error('CANCELLED');
  }
  let finish;
  completion = new Promise(resolve => { finish = resolve; });
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
    workerData: { name, args },
    resourceLimits: { maxOldGenerationSizeMb: LIMITS.workerHeapMb, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 },
    // Keep host preload hooks/secret configuration out of the computation.
    execArgv: [], env: {},
  });
  active.add(worker);
  let timer;
  let abort;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(new Error('CANCELLED'));
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => reject(new Error('WORK_LIMIT')), LIMITS.workMs);
      worker.once('error', () => reject(new Error('WORK_LIMIT')));
      worker.once('exit', code => { if (code !== 0) reject(new Error('WORK_LIMIT')); });
      worker.once('message', message => {
        if (!message.ok) return reject(new Error(message.code));
        if (Buffer.byteLength(JSON.stringify(message.value)) > LIMITS.outputBytes) return reject(new Error('OUTPUT_LIMIT'));
        resolve(message.value);
      });
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await worker.terminate();
    active.delete(worker);
    finish();
  }
}
