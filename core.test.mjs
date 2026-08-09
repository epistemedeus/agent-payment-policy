import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  assertResolvedPublicAddresses,
  authorizePlan,
  createIntent,
  createPlan,
  createReceipt,
  normalizeRequest,
  verifyAuthorization,
} from "./core.mjs";

const NOW = Date.parse("2026-08-09T20:00:00.000Z");
const RECIPIENT = "0x2222222222222222222222222222222222222222";

function intent(overrides = {}) {
  return createIntent({
    purposeId: "buyer.need.001",
    need: "obtain one fresh structured market observation",
    output: { mediaType: "application/json", requiredFields: ["data.value"], maxResponseBytes: 10_000 },
    economics: { expectedValueAtomic: "100000", integrationCostAtomic: "1000", verificationCostAtomic: "1000", riskReserveAtomic: "3000", maxTotalCostAtomic: "50000" },
    policy: { maxAtomic: "25000", dailyCapAtomic: "30000", allowedProtocols: ["x402", "mpp"], protocolPreference: ["x402", "mpp"], buyerAddress: "0x1111111111111111111111111111111111111111", ownedOrigins: ["https://owned.example"] },
    ...overrides,
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

test("creates an immutable private-need digest without retaining the plaintext need", () => {
  const value = intent();
  assert.equal(value.schemaVersion, "agent-payment-policy.intent.v1");
  assert.match(value.needDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal("need" in value, false);
  assert.equal(Object.isFrozen(value), true);
});

test("binds a private full URL while exposing only route and query-key evidence", () => {
  const request = normalizeRequest("get", "https://seller.example/data?asset=ETH&window=5m");
  assert.equal(request.publicRoute, "GET https://seller.example/data");
  assert.deepEqual(request.queryKeys, ["asset", "window"]);
  assert.doesNotMatch(JSON.stringify(request), /ETH|5m/);
  assert.match(request.bindingDigest, /^sha256:/);
});

test("rejects credential URLs and private or reserved destinations", () => {
  assert.throws(() => normalizeRequest("GET", "https://api.example/data?api_key=secret"), /credential-like/);
  assert.throws(() => normalizeRequest("GET", "https://127.0.0.1/data"), /private, local, reserved/);
  assert.throws(() => normalizeRequest("GET", "https://localhost/data"), /local or private/);
  assert.throws(() => assertResolvedPublicAddresses(["10.0.0.1"]), /private, local, reserved/);
  assert.deepEqual(assertResolvedPublicAddresses(["1.1.1.1", "2606:4700:4700::1111"]), ["1.1.1.1", "2606:4700:4700::1111"]);
});

test("selects the cheapest policy-compliant offer and preserves every kill", () => {
  const plan = createPlan({
    intent: intent(),
    offers: [
      offer({ url: "https://owned.example/data" }),
      offer({ amountAtomic: "26000" }),
      offer({ protocol: "mpp", amountAtomic: "9000" }),
      offer(),
    ],
    spentTodayAtomic: "1000",
    now: NOW,
  });
  assert.equal(plan.decision, "authorized_candidate");
  assert.equal(plan.selected.protocol, "mpp");
  assert.equal(plan.selected.amountAtomic, "9000");
  assert.equal(plan.killed.length, 2);
  assert.match(plan.killed[0].reason, /owned supply/);
  assert.match(plan.killed[1].reason, /per-call cap/);
});

test("keeps approval separate from execution and verifies exact plan binding", () => {
  const plan = createPlan({ intent: intent(), offers: [offer()], now: NOW });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const envelope = authorizePlan(plan, { privateKey, kid: "policy-2026-08", now: NOW, ttlMs: 60_000 });
  const authorization = verifyAuthorization(envelope, { publicKey, plan, now: NOW + 1_000 });
  assert.equal(authorization.planId, plan.planId);
  assert.equal(authorization.requestBindingDigest, plan.selected.request.bindingDigest);
  const tamperedSignature = `${envelope.signature[0] === "A" ? "B" : "A"}${envelope.signature.slice(1)}`;
  assert.throws(() => verifyAuthorization({ ...envelope, signature: tamperedSignature }, { publicKey, plan, now: NOW + 1_000 }), /signature/);
});

test("creates public-safe receipt evidence and rejects overcharge or invalid output", () => {
  const plan = createPlan({ intent: intent(), offers: [offer()], now: NOW });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const envelope = authorizePlan(plan, { privateKey, kid: "policy-2026-08", now: NOW });
  const authorization = verifyAuthorization(envelope, { publicKey, plan, now: NOW + 1_000 });
  const receipt = createReceipt({ plan, authorization, amountAtomic: "10000", transactionReference: "0xabc", response: { data: { value: 42 } }, now: NOW + 2_000 });
  assert.equal(receipt.settlement.amountAtomic, "10000");
  assert.equal(receipt.request.publicRoute, "GET https://seller.example/data");
  assert.doesNotMatch(JSON.stringify(receipt), /ETH/);
  assert.throws(() => createReceipt({ plan, authorization, amountAtomic: "10001", transactionReference: "0xabc", response: { data: { value: 42 } } }), /exceeds authorization/);
  assert.throws(() => createReceipt({ plan, authorization, amountAtomic: "10000", transactionReference: "0xabc", response: { data: {} } }), /missing required/);
  assert.throws(() => createReceipt({ plan, authorization: { ...authorization }, amountAtomic: "10000", transactionReference: "0xabc", response: { data: { value: 42 } } }), /verified authorization/);
  assert.throws(() => createReceipt({ plan, authorization, amountAtomic: "10000", transactionReference: "", response: { data: { value: 42 } } }), /transactionReference/);
});
