import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = [
  "examples/mock-x402-mpp-preflight.mjs",
  "examples/verify-policy-receipt.mjs",
];
const FORBIDDEN_SOURCE = [
  /\bauthorizePlan\b/,
  /\bauthorizeExecution\b/,
  /\bsignServiceDeploymentStatement\b/,
  /\bgenerateKeyPair(?:Sync)?\b/,
  /\bcreatePrivateKey\b/,
  /\bcreateSign\b/,
  /\bprivateKey\b/,
  /\bfetch\s*\(/,
  /from ["']node:(crypto|http|https|net|tls|dgram|dns|child_process)["']/,
  /process\.env/,
];

function isolatedNpmEnv() {
  // CI `npm pack --dry-run` runs prepack -> npm test with npm_config_dry_run set.
  // A nested pack that inherits it prints JSON and does not write a tarball.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    const lower = key.toLowerCase();
    if (
      lower === "npm_config_dry_run" ||
      lower === "npm_config_pack_destination" ||
      lower === "npm_config_json" ||
      lower === "npm_lifecycle_event" ||
      lower === "npm_lifecycle_script" ||
      lower === "npm_command"
    ) {
      delete env[key];
    }
  }
  return env;
}

function runNode(args, { cwd = ROOT } = {}) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
}

function parseJsonProcess(result, label) {
  assert.equal(result.status, 0, `${label} failed: ${result.stderr || result.stdout}`);
  assert.equal(result.stderr.trim(), "", `${label} wrote stderr`);
  return JSON.parse(result.stdout);
}

function assertHarmlessBoundary(boundary, label) {
  assert.equal(boundary.networkAccessed ?? false, false, `${label} networkAccessed`);
  assert.equal(boundary.walletAccessed ?? false, false, `${label} walletAccessed`);
  assert.equal(boundary.paymentSigned, false, `${label} paymentSigned`);
  assert.equal(boundary.paymentSent, false, `${label} paymentSent`);
  assert.equal(boundary.credentialsUsed ?? boundary.credentialsAccepted ?? false, false, `${label} credentials`);
}

test("adoption example sources do not sign, fetch, or load credentials", () => {
  for (const relative of EXAMPLES) {
    const source = readFileSync(join(ROOT, relative), "utf8");
    for (const pattern of FORBIDDEN_SOURCE) {
      assert.doesNotMatch(source, pattern, `${relative} matched ${pattern}`);
    }
  }
  const fixture = readFileSync(join(ROOT, "examples/fixtures/policy-authorization.json"), "utf8");
  assert.doesNotMatch(fixture, /BEGIN PRIVATE KEY/);
  assert.match(fixture, /"privateKeyRetained": false/);
});

test("mock x402/MPP preflight selects a plan without signing or paying", () => {
  const report = parseJsonProcess(runNode(["examples/mock-x402-mpp-preflight.mjs"]), "preflight");
  assert.equal(report.listingIdentity.decision, "canonical");
  assert.equal(report.coherence.x402.decision, "coherent");
  assert.equal(report.coherence.mpp.decision, "coherent");
  assert.equal(report.responseContract.decision, "admissible");
  assert.equal(report.purchaseEvidence.status, "verified");
  assert.equal(report.purchaseEvidence.declaration, "seller_declared");
  assert.equal(report.plan.decision, "authorized_candidate");
  assert.equal(report.plan.selected.protocol, "mpp");
  assert.equal(report.plan.selected.publicRoute, "GET https://seller.example/data");
  assert.equal(report.plan.killed.length, 3);
  assert.equal(report.boundary.policyAuthorizationCreated, false);
  assert.equal(report.boundary.catalogEqualsRuntime, true);
  assert.equal(report.boundary.purchaseEvidenceIndependentlyFetched, false);
  assertHarmlessBoundary(report.boundary, "preflight");
  assertHarmlessBoundary(report.coherence.x402.boundary, "x402 coherence");
  assertHarmlessBoundary(report.coherence.mpp.boundary, "mpp coherence");
  assertHarmlessBoundary(report.listingIdentity.boundary, "listing identity");
  assertHarmlessBoundary(report.responseContract.boundary, "response contract");
  assertHarmlessBoundary(report.outputSchema, "output schema");
  assert.doesNotMatch(JSON.stringify(report), /ETH/);
});

test("policy/receipt verification uses a frozen fixture and does not pay", () => {
  const report = parseJsonProcess(runNode(["examples/verify-policy-receipt.mjs"]), "verify");
  assert.equal(report.receipt.publicRoute, "GET https://seller.example/data");
  assert.deepEqual(report.receipt.queryKeys, ["asset"]);
  assert.equal(report.receipt.output.valid, true);
  assert.equal(report.receipt.output.schemaValidated, true);
  assert.equal(report.completeness.state, "reconciled");
  assert.equal(report.completeness.deliveryState, "valid");
  assert.match(
    report.completeness.evidenceBoundary,
    /Classifies caller-verified normalized facts/,
  );
  assert.match(report.completeness.evidenceBoundary, /does not parse raw receipts/);
  assert.equal(report.boundary.policyAuthorizationVerified, true);
  assert.equal(report.boundary.completenessObservationsSynthetic, true);
  assert.match(report.boundary.statement, /synthetic fixture classifier/);
  assertHarmlessBoundary(report.boundary, "verify");
  assertHarmlessBoundary(report.completeness, "completeness");
  assert.doesNotMatch(JSON.stringify(report), /ETH/);
  assert.doesNotMatch(JSON.stringify(report), /BEGIN PRIVATE KEY/);
});

test("CLI default path does not generate keys, sign, or pay", () => {
  const result = runNode(["cli.mjs"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: agent-payment-policy /);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /walletLoaded|paymentSigned|paymentSent|BEGIN [A-Z ]*PRIVATE KEY/);
});

test("package import performs no signing or payment", async () => {
  const mod = await import("./core.mjs");
  assert.equal(mod.SCHEMAS.plan, "agent-payment-policy.plan.v1");
  assert.equal(typeof mod.authorizePlan, "function");
  assert.equal(typeof mod.createPlan, "function");
});

test("packed package examples run in a temporary consumer", { timeout: 120_000 }, () => {
  const scratch = mkdtempSync(join(tmpdir(), "agent-payment-policy-consumer-"));
  const previousDryRun = process.env.npm_config_dry_run;
  process.env.npm_config_dry_run = "true";
  try {
    const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch], {
      cwd: ROOT,
      encoding: "utf8",
      env: isolatedNpmEnv(),
    });
    assert.equal(pack.status, 0, pack.stderr);
    const packed = JSON.parse(pack.stdout);
    const tarball = join(scratch, packed[0].filename);
    assert.equal(existsSync(tarball), true, `inner pack did not write ${tarball}`);
    const consumer = join(scratch, "consumer");
    mkdirSync(consumer);
    writeFileSync(join(consumer, "package.json"), `${JSON.stringify({
      name: "adoption-consumer",
      private: true,
      type: "module",
    }, null, 2)}\n`);
    const install = spawnSync("npm", ["install", tarball, "--ignore-scripts", "--no-fund", "--no-audit"], {
      cwd: consumer,
      encoding: "utf8",
      env: isolatedNpmEnv(),
    });
    assert.equal(install.status, 0, install.stderr + install.stdout);
    const installedExamples = join(consumer, "node_modules/agent-payment-policy/examples");
    assert.deepEqual(
      readdirSync(installedExamples).filter((name) => name.endsWith(".mjs")).sort(),
      ["mock-x402-mpp-preflight.mjs", "verify-policy-receipt.mjs"],
    );
    assert.equal(
      readdirSync(join(installedExamples, "fixtures")).includes("policy-authorization.json"),
      true,
    );
    const inplacePreflight = parseJsonProcess(
      runNode(["node_modules/agent-payment-policy/examples/mock-x402-mpp-preflight.mjs"], { cwd: consumer }),
      "inplace consumer preflight",
    );
    const inplaceVerify = parseJsonProcess(
      runNode(["node_modules/agent-payment-policy/examples/verify-policy-receipt.mjs"], { cwd: consumer }),
      "inplace consumer verify",
    );
    assert.equal(inplacePreflight.plan.selected.protocol, "mpp");
    assert.equal(inplacePreflight.boundary.paymentSent, false);
    assert.equal(inplaceVerify.completeness.state, "reconciled");
    assert.equal(inplaceVerify.boundary.completenessObservationsSynthetic, true);
    assert.match(inplaceVerify.completeness.evidenceBoundary, /does not parse raw receipts/);
    cpSync(installedExamples, join(consumer, "examples"), { recursive: true });
    const preflight = parseJsonProcess(
      runNode(["examples/mock-x402-mpp-preflight.mjs"], { cwd: consumer }),
      "consumer preflight",
    );
    const verify = parseJsonProcess(
      runNode(["examples/verify-policy-receipt.mjs"], { cwd: consumer }),
      "consumer verify",
    );
    assert.equal(preflight.plan.selected.protocol, "mpp");
    assert.equal(preflight.boundary.paymentSent, false);
    assert.equal(preflight.purchaseEvidence.declaration, "seller_declared");
    assert.equal(verify.completeness.state, "reconciled");
    assert.equal(verify.boundary.paymentSigned, false);
    assert.equal(verify.boundary.completenessObservationsSynthetic, true);
  } finally {
    if (previousDryRun === undefined) delete process.env.npm_config_dry_run;
    else process.env.npm_config_dry_run = previousDryRun;
    rmSync(scratch, { recursive: true, force: true });
  }
});
