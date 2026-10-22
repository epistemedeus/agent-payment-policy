import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { checkBinding } from '../release/check-binding.mjs';

const raw = readFileSync(new URL('../release/server.schema.json', import.meta.url));
assert.equal(createHash('sha256').update(raw).digest('hex'), '3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0');
const schema = JSON.parse(raw);
assert.equal(schema.$id, 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const pkg = JSON.parse(readFileSync('package.json'));
const manifest = JSON.parse(readFileSync('server.json'));
const publisher = process.argv[2];
const evidence = process.env.MCP_EVIDENCE_DIR;
assert.ok(evidence, 'set MCP_EVIDENCE_DIR outside the source tree');
const source = JSON.parse(readFileSync('SOURCE-MANIFEST.json'));
mkdirSync(`${evidence}/release-controls`, { recursive: true });
const cases = [
  ['candidate', () => {}, true, true],
  ['missing_repository', (p, m) => { delete p.repository; delete m.repository; }, true, false],
  ['wrong_repository_together', (p, m) => { p.repository.url = 'git+https://github.com/epistemedeus/pilot.git'; m.repository.url = 'https://github.com/epistemedeus/pilot'; }, true, false],
  ['wrong_package_directory', p => { p.repository.directory = 'other'; }, true, false],
  ['wrong_subfolder_together', (p, m) => { p.repository.directory = m.repository.subfolder = 'other'; }, true, false],
  ['wrong_source_host', (_p, m) => { m.repository.source = 'gitlab'; }, true, false],
  ['wrong_source_role', (_p, _m, s) => { s.adapterPublicSource.role = 'producer'; }, true, false],
  ['wrong_source_repository', (_p, _m, s) => { s.adapterPublicSource.repository = 'https://github.com/epistemedeus/pilot'; }, true, false],
  ['wrong_source_directory', (_p, _m, s) => { s.adapterPublicSource.directory = 'other'; }, true, false],
  ['mcpName_mismatch', p => { p.mcpName += '-wrong'; }, true, false],
  ['package_name_drift', p => { p.name += '-wrong'; }, true, false],
  ['package_version_drift', p => { p.version = '0.1.1'; }, true, false],
  ['manifest_name_drift', (_p, m) => { m.name += '-wrong'; }, true, false],
  ['manifest_version_drift', (_p, m) => { m.version = '0.1.1'; }, true, false],
  ['invalid_transport', (_p, m) => { m.packages[0].transport.type = 'not-stdio'; }, false, false],
  ['invalid_schema_url', (_p, m) => { m.$schema = 'https://example.invalid/schema.json'; }, true, false],
  ['missing_description', (_p, m) => { delete m.description; }, false, false],
  ['long_description', (_p, m) => { m.description = 'x'.repeat(101); }, false, false],
  ['unqualified_field', (_p, m) => { m.unqualified = 'must-not-ship'; }, true, false],
];
const results = [];
for (const [label, mutate, schemaExpected, bindingExpected] of cases) {
  const p = structuredClone(pkg), m = structuredClone(manifest), src = structuredClone(source);
  mutate(p, m, src);
  const schemaValid = validate(m);
  assert.equal(schemaValid, schemaExpected, `${label} dated-schema outcome`);
  const bindingErrors = checkBinding(p, m, src);
  assert.equal(bindingErrors.length === 0, bindingExpected, `${label} binding outcome`);
  const file = `${evidence}/release-controls/${label}.json`;
  writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  const argv = ['validate', file];
  const run = publisher ? spawnSync(publisher, argv, { encoding: 'utf8', timeout: 10000, maxBuffer: 32768,
    env: { PATH: process.env.PATH, HOME: process.env.MCP_PUBLISHER_TEST_HOME } }) : { status: null, stdout: '', stderr: '' };
  assert.ifError(run.error);
  writeFileSync(`${evidence}/release-controls/${label}.log`, run.stdout + run.stderr);
  if (publisher && label === 'candidate') assert.equal(run.status, 0, 'actual publisher validates candidate');
  // Published artifact ownership/cross-file binding is NOT checked by validate.
  if (publisher && ['invalid_transport', 'missing_description', 'long_description'].includes(label)) assert.notEqual(run.status, 0, `${label} publisher structural refusal`);
  results.push({ label, datedSchemaValid: schemaValid, localBindingValid: bindingErrors.length === 0,
    localBindingErrors: bindingErrors, publisherArgv: publisher ? [publisher, ...argv] : null, publisherExit: run.status,
    distinction: 'local structural validation; no package ownership or namespace authentication tested' });
}
writeFileSync(`${evidence}/release-validation.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, cases: results, schemaSha256: createHash('sha256').update(raw).digest('hex') }));
