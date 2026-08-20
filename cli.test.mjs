import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  authorizeExecution,
  authorizePlan,
  createIntent,
  createPlan,
  inspectOutputSchema,
  SCHEMAS,
  verifyAuthorization,
} from "./core.mjs";

const CLI = new URL("./cli.mjs", import.meta.url);
const NOW = Date.parse("2026-08-09T20:00:00.000Z");
const RECIPIENT = "0x2222222222222222222222222222222222222222";

function run(args) {
  return spawnSync(process.execPath, [CLI.pathname, ...args], {
    encoding: "utf8",
    cwd: new URL(".", import.meta.url).pathname,
  });
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "agent-payment-policy-"));
}

function writeJson(directory, name, value) {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function intent() {
  return createIntent({
    purposeId: "buyer.need.001",
    need: "obtain one fresh structured market observation",
    output: { mediaType: "application/json", requiredFields: ["data.value"], maxResponseBytes: 10_000 },
    economics: {
      expectedValueAtomic: "100000",
      integrationCostAtomic: "1000",
      verificationCostAtomic: "1000",
      riskReserveAtomic: "3000",
      maxTotalCostAtomic: "50000",
    },
    policy: {
      maxAtomic: "25000",
      dailyCapAtomic: "30000",
      allowedProtocols: ["x402", "mpp"],
      protocolPreference: ["x402", "mpp"],
      buyerAddress: "0x1111111111111111111111111111111111111111",
      ownedOrigins: ["https://owned.example"],
    },
  }, { now: NOW });
}

function offer(overrides = {}) {
  return {
    protocol: "x402",
    method: "GET",
    url: "https://seller.example/data?asset=ETH",
    amountAtomic: "10000",
    recipient: RECIPIENT,
    network: "eip155:8453",
    asset: "USDC",
    expiresAt: new Date(NOW + 120_000).toISOString(),
    ...overrides,
  };
}

function nansenSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: {
      data: {
        type: "object",
        additionalProperties: false,
        required: ["source", "value", "observedAt"],
        properties: {
          source: { type: "string", format: "uri" },
          value: { type: "number", minimum: 0 },
          observedAt: { type: "string", format: "date-time" },
        },
      },
    },
  };
}

function receiptObservation(overrides = {}) {
  return {
    schemaVersion: SCHEMAS.receiptCompletenessObservation,
    protocol: "mpp",
    receipt: {
      present: true,
      success: "confirmed",
      transactionReference: "match",
      amount: "missing",
      network: "missing",
      asset: "missing",
      recipient: "missing",
      payer: "missing",
    },
    transaction: {
      checked: false,
      success: "unknown",
      transactionReference: "not_checked",
      amount: "not_checked",
      network: "not_checked",
      asset: "not_checked",
      recipient: "not_checked",
      payer: "not_checked",
    },
    balance: { checked: true, delta: "match", asset: "match", payer: "match" },
    outputValidation: "failed",
    ...overrides,
  };
}

test("construct-request refuses a bare extract path and binds a finished example URL", () => {
  const directory = tempDir();
  const bare = run(["construct-request", writeJson(directory, "bare.json", {
    method: "GET",
    url: "/extract",
  })]);
  assert.equal(bare.status, 0);
  const refused = JSON.parse(bare.stdout);
  assert.equal(refused.decision, "not_constructible");
  assert.deepEqual(refused.reasons, ["missing_example"]);

  const bound = run(["construct-request", writeJson(directory, "finished.json", {
    method: "GET",
    url: "https://agents.samedaydesk.com/extract?url=https://example.com",
  })]);
  assert.equal(bound.status, 0);
  const accepted = JSON.parse(bound.stdout);
  assert.equal(accepted.decision, "request_constructible");
  assert.equal(accepted.request.publicRoute, "GET https://agents.samedaydesk.com/extract");
  assert.doesNotMatch(bound.stdout, /example\.com/);

  const schema = run(["construct-request-schema"]);
  assert.equal(schema.status, 0);
  assert.equal(JSON.parse(schema.stdout).output.properties.decision.enum[1], "not_constructible");
});

test("plan-check reports authorized_candidate or no_viable_offer without a key", () => {
  const directory = tempDir();
  const viable = run(["plan-check", writeJson(directory, "viable.json", {
    intent: intent(),
    offers: [offer()],
    now: NOW,
  })]);
  assert.equal(viable.status, 0);
  assert.equal(JSON.parse(viable.stdout).decision, "authorized_candidate");
  assert.doesNotMatch(viable.stdout, /privateKey|BEGIN PRIVATE KEY|wallet/i);

  const overCap = run(["plan-check", writeJson(directory, "over-cap.json", {
    intent: intent(),
    offers: [offer({ amountAtomic: "26000" })],
    now: NOW,
  })]);
  const stale = run(["plan-check", writeJson(directory, "stale.json", {
    intent: intent(),
    offers: [offer({ expiresAt: new Date(NOW - 1_000).toISOString() })],
    now: NOW,
  })]);
  const selfPay = run(["plan-check", writeJson(directory, "self-pay.json", {
    intent: intent(),
    offers: [offer({ recipient: "0x1111111111111111111111111111111111111111" })],
    now: NOW,
  })]);
  for (const result of [overCap, stale, selfPay]) {
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).decision, "no_viable_offer");
  }
});

test("verify-authorization accepts a matching envelope and rejects a tampered plan", () => {
  const directory = tempDir();
  const now = Date.now();
  const liveIntent = createIntent({
    purposeId: "buyer.need.001",
    need: "obtain one fresh structured market observation",
    output: { mediaType: "application/json", requiredFields: ["data.value"], maxResponseBytes: 10_000 },
    economics: {
      expectedValueAtomic: "100000",
      integrationCostAtomic: "1000",
      verificationCostAtomic: "1000",
      riskReserveAtomic: "3000",
      maxTotalCostAtomic: "50000",
    },
    policy: {
      maxAtomic: "25000",
      dailyCapAtomic: "30000",
      allowedProtocols: ["x402", "mpp"],
      protocolPreference: ["x402", "mpp"],
      buyerAddress: "0x1111111111111111111111111111111111111111",
      ownedOrigins: ["https://owned.example"],
    },
  }, { now });
  const plan = createPlan({
    intent: liveIntent,
    offers: [offer({ expiresAt: new Date(now + 120_000).toISOString() })],
    now,
  });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const envelope = authorizePlan(plan, { privateKey, kid: "policy-cli", now, ttlMs: 60_000 });
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const publicKeyPath = join(directory, "public.pem");
  writeFileSync(publicKeyPath, publicPem);
  const envelopePath = writeJson(directory, "envelope.json", envelope);
  const planPath = writeJson(directory, "plan.json", plan);

  const verified = run(["verify-authorization", envelopePath, publicKeyPath, planPath]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).planId, plan.planId);

  const tampered = run(["verify-authorization", envelopePath, publicKeyPath, writeJson(directory, "tampered.json", {
    ...plan,
    planId: `sha256:${"a".repeat(64)}`,
  })]);
  assert.notEqual(tampered.status, 0);

  const executionAction = { calls: [{ to: RECIPIENT, value: "0x0", data: "0x01" }] };
  const authorization = verifyAuthorization(envelope, { publicKey, plan, now: now + 1_000 });
  const executionEnvelope = authorizeExecution({
    authorization,
    method: "eth_signTransaction",
    network: "eip155:8453",
    action: executionAction,
  }, { privateKey, kid: "policy-execution", now, ttlMs: 60_000 });
  const execution = run(["verify-execution", writeJson(directory, "execution.json", executionEnvelope), publicKeyPath, writeJson(directory, "execution-context.json", {
    authorizationEnvelope: envelope,
    plan,
    method: "eth_signTransaction",
    network: "eip155:8453",
    action: executionAction,
  })]);
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(JSON.parse(execution.stdout).actionBinding.digest, /^sha256:[0-9a-f]{64}$/);
});

test("output-accept hashes a Nansen-shaped body and rejects a wrong-type body without echoing it", () => {
  const directory = tempDir();
  const schema = nansenSchema();
  const digest = inspectOutputSchema({ schema }).schemaDigest;
  const schemaPath = writeJson(directory, "schema.json", schema);
  const validBody = {
    data: {
      source: "https://api.nansen.ai/v1/token",
      value: 42.5,
      observedAt: "2026-08-20T00:00:00.000Z",
    },
  };
  const accepted = run(["output-accept", schemaPath, digest, writeJson(directory, "valid.json", validBody)]);
  assert.equal(accepted.status, 0);
  const acceptedBody = JSON.parse(accepted.stdout);
  assert.equal(acceptedBody.valid, true);
  assert.match(acceptedBody.responseDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(acceptedBody.schemaDigest, digest);
  assert.doesNotMatch(accepted.stdout, /nansen|42\.5|observedAt/i);

  const rejected = run(["output-accept", schemaPath, digest, writeJson(directory, "wrong-type.json", {
    data: {
      source: "https://api.nansen.ai/v1/token",
      value: "42.5",
      observedAt: "2026-08-20T00:00:00.000Z",
    },
  })]);
  assert.equal(rejected.status, 1);
  assert.deepEqual(JSON.parse(rejected.stdout), { valid: false });
  assert.doesNotMatch(rejected.stdout, /42\.5|nansen|wrong-type/i);
});

test("receipt-completeness-check stays exit 0 by default and can fail only on conflict", () => {
  const directory = tempDir();
  const partialPath = writeJson(directory, "partial.json", receiptObservation());
  const conflictPath = writeJson(directory, "conflict.json", receiptObservation({
    receipt: {
      present: true,
      success: "confirmed",
      transactionReference: "match",
      amount: "mismatch",
      network: "missing",
      asset: "missing",
      recipient: "missing",
      payer: "missing",
    },
  }));

  const defaultPartial = run(["receipt-completeness-check", partialPath]);
  assert.equal(defaultPartial.status, 0);
  assert.equal(JSON.parse(defaultPartial.stdout).state, "partial");

  const failOnPartial = run(["receipt-completeness-check", partialPath, "--fail-on", "conflict"]);
  assert.equal(failOnPartial.status, 0);
  assert.equal(JSON.parse(failOnPartial.stdout).state, "partial");

  const defaultConflict = run(["receipt-completeness-check", conflictPath]);
  assert.equal(defaultConflict.status, 0);
  assert.equal(JSON.parse(defaultConflict.stdout).state, "conflict");

  const failOnConflict = run(["receipt-completeness-check", conflictPath, "--fail-on", "conflict"]);
  assert.equal(failOnConflict.status, 1);
  assert.equal(JSON.parse(failOnConflict.stdout).state, "conflict");
});

test("demo and the five-minute no-pay commands stay wallet-free", () => {
  const inspect = run(["inspect-url", "https://example.com/data?asset=ETH"]);
  assert.equal(inspect.status, 0);
  assert.equal(JSON.parse(inspect.stdout).publicRoute, "GET https://example.com/data");

  const demo = run(["demo"]);
  assert.equal(demo.status, 0);
  const demoBody = JSON.parse(demo.stdout);
  assert.equal(demoBody.walletLoaded, false);
  assert.equal(demoBody.paymentSigned, false);
  assert.equal(demoBody.paymentSent, false);
});
