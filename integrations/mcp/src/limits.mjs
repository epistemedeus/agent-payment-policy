export const LIMITS = Object.freeze({
  argumentBytes: 65_536, wireBytes: 131_072, outputBytes: 65_536,
  depth: 16, arrayItems: 256, objectKeys: 256, nodes: 4096,
  schemaNodes: 256, stringBytes: 32_768, workMs: 1500, workerHeapMb: 64,
});

export function checkArguments(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > LIMITS.argumentBytes) throw new Error('ARGUMENT_LIMIT');
  let nodes = 0;
  function visit(v, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) throw new Error('ARGUMENT_LIMIT');
    if (typeof v === 'string' && Buffer.byteLength(v) > LIMITS.stringBytes) throw new Error('ARGUMENT_LIMIT');
    if (!v || typeof v !== 'object') return;
    const entries = Object.entries(v);
    if (entries.length > (Array.isArray(v) ? LIMITS.arrayItems : LIMITS.objectKeys)) throw new Error('ARGUMENT_LIMIT');
    for (const [key, child] of entries) {
      if (Buffer.byteLength(key) > 512) throw new Error('ARGUMENT_LIMIT');
      visit(child, depth + 1);
    }
  }
  visit(value, 0);
  if (value?.schema) {
    let schemaNodes = 0;
    function schemaVisit(v) {
      if (++schemaNodes > LIMITS.schemaNodes) throw new Error('ARGUMENT_LIMIT');
      if (v && typeof v === 'object') for (const child of Object.values(v)) schemaVisit(child);
    }
    schemaVisit(value.schema);
  }
}
