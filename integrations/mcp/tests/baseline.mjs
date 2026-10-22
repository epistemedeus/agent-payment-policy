// Run before the MCP suite, using the unchanged acquired policy core/CLI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  fixtures, schemaDigest, expectedNormalize, expectedInspection, expectedAcceptance,
  expectedReceipt, receiptObservation, normalizeRefusals,
} from './oracle.mjs';

const publishedCore = import.meta.resolve('agent-payment-policy');
const corePath = resolve(process.env.POLICY_CORE || fileURLToPath(publishedCore));
const cliPath = resolve(process.env.POLICY_CLI || fileURLToPath(new URL('./cli.mjs', publishedCore)));
const core = await import(pathToFileURL(corePath));
const started = performance.now();
const checks = [];
const cli = [];
const outputs = {};
const scratch = mkdtempSync(`${tmpdir()}/policy-mcp-baseline-`);
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  checks.push(name); outputs[name] = actual;
}
function file(name, value) {
  const path = `${scratch}/${name}.json`;
  writeFileSync(path, JSON.stringify(value));
  return path;
}
function runCli(args, expected, exit = 0) {
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', cliPath, ...args], {
    timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_OPTIONS: '--max-old-space-size=128' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, exit, `CLI ${args[0]} exit`);
  assert.deepEqual(JSON.parse(result.stdout), expected, `CLI ${args[0]} payload`);
  assert.equal(result.stderr, '', `CLI ${args[0]} stderr`);
  cli.push({ command: [process.execPath, '--max-old-space-size=128', cliPath, ...args], exit: result.status });
}
try {
  for (const [name, body] of [['body', fixtures.request.body], ['reordered', fixtures.request.reorderedBody], ['changed', fixtures.request.changedBody]]) {
    const expected = expectedNormalize(body);
    check(`normalize_${name}`, core.normalizeRequest('POST', fixtures.request.target, { body, mediaType: 'application/json' }), expected);
    runCli(['inspect-json-request', fixtures.request.target, file(`body-${name}`, body)], expected);
  }
  assert.equal(outputs.normalize_body.bindingDigest, outputs.normalize_reordered.bindingDigest);
  assert.notEqual(outputs.normalize_body.bindingDigest, outputs.normalize_changed.bindingDigest);
  check('schema', core.inspectOutputSchema({ schema: fixtures.schema, requiredFields: fixtures.requiredFields }), expectedInspection);
  const schemaFile = file('schema', fixtures.schema);
  runCli(['output-schema-check', schemaFile, fixtures.requiredFields.join(',')], expectedInspection);
  for (const [name, output] of Object.entries(fixtures.outputs)) {
    let actual;
    try {
      const inspection = core.inspectOutputSchema({ schema: fixtures.schema });
      assert.equal(inspection.schemaDigest, schemaDigest);
      const contract = { mediaType: 'application/json', requiredFields: inspection.requiredPaths, schemaDigest };
      const validator = core.prepareOutputValidator({ schema: fixtures.schema, contract });
      const value = core.validateOutput(output, contract, { schemaValidator: validator });
      actual = { valid: true, responseDigest: value.responseDigest, schemaDigest: value.schemaDigest };
    } catch { actual = { valid: false }; }
    check(`accept_${name}`, actual, expectedAcceptance(name));
    runCli(['output-accept', schemaFile, schemaDigest, file(`output-${name}`, output)], expectedAcceptance(name), fixtures.expectedOutputAcceptance[name] ? 0 : 1);
  }
  runCli(['output-accept', schemaFile, `sha256:${'0'.repeat(64)}`, file('wrong-digest-output', fixtures.outputs.valid)], { valid: false }, 1);
  for (const variant of fixtures.receiptVariants) {
    const observation = receiptObservation(variant), expected = expectedReceipt(variant);
    check(`receipt_${variant.name}`, core.evaluateReceiptCompleteness(observation), expected);
    const observationFile = file(`receipt-${variant.name}`, observation);
    runCli(['receipt-completeness-check', observationFile], expected);
    if (variant.state === 'conflict') runCli(['receipt-completeness-check', observationFile, '--fail-on', 'conflict'], expected, 1);
  }
  for (const [name, args] of normalizeRefusals) {
    assert.throws(() => core.normalizeRequest(args.method, args.target, args.options), `core refusal ${name}`);
    checks.push(`refusal_${name}`);
  }
  console.log(JSON.stringify({ ok: true, sourceCommit: fixtures.policySourceCommit, checks, cli, outputs, elapsedMs: Math.round(performance.now() - started) }));
} finally { rmSync(scratch, { recursive: true, force: true }); }
