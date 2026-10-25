import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

async function identity(pid) {
  try {
    const stat = (await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ')[1].split(' ');
    return { pid, startTicks: stat[19], rssKiB: Number(stat[21]) * 4 };
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
}
async function descendants(pid, found = []) {
  let children;
  try { children = (await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return found; throw error; }
  for (const child of children) {
    const record = await identity(Number(child));
    if (record) { found.push(record); await descendants(record.pid, found); }
  }
  return found;
}
export function monitorOwnedProcesses() {
  const observed = new Map();
  let maximumAggregateKiB = 0;
  let stopped = false;
  const run = (async () => {
    while (!stopped) {
      const sample = await descendants(process.pid);
      for (const record of sample) observed.set(`${record.pid}:${record.startTicks}`, record);
      const self = await identity(process.pid);
      maximumAggregateKiB = Math.max(maximumAggregateKiB, (self?.rssKiB || 0) + sample.reduce((n, r) => n + r.rssKiB, 0));
      await delay(20);
    }
  })();
  return async () => {
    stopped = true;
    await run;
    const records = [...observed.values()];
    let survivors = [];
    for (let n = 0; n < 100; n++) {
      survivors = [];
      for (const record of records) {
        const current = await identity(record.pid);
        if (current?.startTicks === record.startTicks) survivors.push(record.pid);
      }
      if (!survivors.length) break;
      await delay(20);
    }
    return { sampledMaximumAggregateKiB: maximumAggregateKiB, sampleIntervalMs: 20,
      observedProcesses: records.map(({ pid, startTicks }) => ({ pid, startTicks })),
      survivors, currentChildren: (await descendants(process.pid)).map(r => r.pid) };
  };
}
