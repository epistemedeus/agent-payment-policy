import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  assertResolvedPublicAddresses,
  assertControlCoverage,
  authorizeExecution,
  authorizePlan,
  canonicalRequestBody,
  createControlCoverage,
  createIntent,
  createPlan,
  createReceipt,
  normalizeRequest,
  verifyAuthorization,
  verifyExecutionAuthorization,
  PAYMENT_CONTROL_DIMENSIONS,
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
  assert.equal(request.bodyBinding, null);
});

test("canonically binds a private JSON POST body without retaining body values", () => {
  const left = normalizeRequest("POST", "https://seller.example/analyze?mode=fast", {
    body: { types: ["A", "MX"], domain: "buyer.example" },
    mediaType: "application/json",
  });
  const right = normalizeRequest("POST", "https://seller.example/analyze?mode=fast", {
    body: { domain: "buyer.example", types: ["A", "MX"] },
  });
  assert.equal(left.bindingDigest, right.bindingDigest);
  assert.deepEqual(left.bodyBinding, {
    mediaType: "application/json",
    bytes: Buffer.byteLength('{"domain":"buyer.example","types":["A","MX"]}'),
    digest: right.bodyBinding.digest,
  });
  assert.doesNotMatch(JSON.stringify(left), /buyer\.example|\"A\"|\"MX\"/);
  assert.notEqual(left.bindingDigest, normalizeRequest("POST", "https://seller.example/analyze?mode=fast", { body: { domain: "other.example", types: ["A", "MX"] } }).bindingDigest);
  assert.equal(canonicalRequestBody({ z: 1, a: 2 }), '{"a":2,"z":1}');
});

test("fails closed on absent, misplaced, or invalid JSON request bodies", () => {
  assert.throws(() => normalizeRequest("POST", "https://seller.example/analyze"), /body is required/);
  assert.throws(() => normalizeRequest("GET", "https://seller.example/analyze", { body: {} }), /not supported/);
  assert.throws(() => normalizeRequest("POST", "https://seller.example/analyze", { body: {}, mediaType: "text/plain" }), /application\/json/);
  assert.throws(() => normalizeRequest("POST", "https://seller.example/analyze", { body: { value: Number.NaN } }), /non-finite/);
});

test("rejects credential URLs and private or reserved destinations", () => {
  assert.throws(() => normalizeRequest("GET", "https://api.example/data?api_key=secret"), /credential-like/);
  assert.throws(() => normalizeRequest("GET", "https://127.0.0.1/data"), /private, local, reserved/);
  assert.throws(() => normalizeRequest("GET", "https://localhost/data"), /local or private/);
  assert.throws(() => assertResolvedPublicAddresses(["10.0.0.1"]), /private, local, reserved/);
  assert.deepEqual(assertResolvedPublicAddresses(["1.1.1.1", "2606:4700:4700::1111"]), ["1.1.1.1", "2606:4700:4700::1111"]);
});

test("admits a complete provider-neutral control profile without an opaque score", () => {
  const coverage = createControlCoverage({
    profileId: "tempo-pathusd",
    provider: "example-signer",
    network: "eip155:42431",
    protocol: "mpp-tempo-charge",
    providerNativeUnsupported: ["operation", "chain", "token_contract", "recipient", "amount", "function"],
    independentVerified: [...PAYMENT_CONTROL_DIMENSIONS],
  });
  const verified = assertControlCoverage(coverage, {
    profileId: "tempo-pathusd",
    provider: "example-signer",
    network: "eip155:42431",
    protocol: "mpp-tempo-charge",
  });
  assert.equal(verified.summary.providerNeutralOnlyCount, 13);
  assert.equal(verified.summary.signingReady, true);
  assert.equal(verified.summary.settlementReady, true);
  assert.equal(Object.isFrozen(coverage), true);
  assert.equal(Object.isFrozen(coverage.controls), true);
});

test("reports defense in depth and rejects uncovered or contradictory controls", () => {
  const mixed = createControlCoverage({
    profileId: "base-usdc",
    provider: "example-signer",
    network: "eip155:8453",
    protocol: "x402",
    providerNativeVerified: ["operation", "chain", "token_contract", "recipient", "amount", "function"],
    independentVerified: [...PAYMENT_CONTROL_DIMENSIONS],
  });
  assert.equal(mixed.summary.defenseInDepthCount, 6);
  assert.equal(mixed.summary.providerNeutralOnlyCount, 7);

  const incomplete = createControlCoverage({
    profileId: "base-usdc",
    provider: "example-signer",
    network: "eip155:8453",
    protocol: "x402",
    independentVerified: PAYMENT_CONTROL_DIMENSIONS.filter((control) => control !== "amount"),
  });
  assert.throws(() => assertControlCoverage(incomplete, {
    profileId: "base-usdc",
    provider: "example-signer",
    network: "eip155:8453",
    protocol: "x402",
  }), /uncovered/);
  assert.throws(() => createControlCoverage({
    profileId: "base-usdc",
    provider: "example-signer",
    network: "eip155:8453",
    protocol: "x402",
    providerNativeVerified: ["amount"],
    providerNativeUnsupported: ["amount"],
  }), /contradicts/);
  assert.throws(() => createControlCoverage({
    profileId: "empty",
    provider: "example-signer",
    network: "eip155:8453",
    protocol: "x402",
    required: [],
  }), /at least one control/);
});

test("rejects a control report whose declared disposition was altered", () => {
  const coverage = createControlCoverage({
    profileId: "base-usdc",
    provider: "example-signer",
    network: "eip155:8453",
    protocol: "mpp",
    independentVerified: [...PAYMENT_CONTROL_DIMENSIONS],
  });
  const controls = coverage.controls.map((entry, index) => index === 0 ? { ...entry, disposition: "defense_in_depth" } : entry);
  assert.throws(() => assertControlCoverage({ ...coverage, controls }, {
    profileId: "base-usdc",
    provider: "example-signer",
    network: "eip155:8453",
    protocol: "mpp",
  }), /inconsistent/);
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

test("rejects offers without an explicit settlement network or asset", () => {
  const noNetwork = createPlan({ intent: intent(), offers: [offer({ network: "" })], now: NOW });
  const noAsset = createPlan({ intent: intent(), offers: [offer({ asset: "" })], now: NOW });
  assert.equal(noNetwork.decision, "no_viable_offer");
  assert.match(noNetwork.killed[0].reason, /network is required/);
  assert.equal(noAsset.decision, "no_viable_offer");
  assert.match(noAsset.killed[0].reason, /asset is required/);
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

test("binds a second signed authorization to the exact execution batch", () => {
  const plan = createPlan({ intent: intent(), offers: [offer()], now: NOW });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const planEnvelope = authorizePlan(plan, { privateKey, kid: "policy-plan", now: NOW });
  const authorization = verifyAuthorization(planEnvelope, { publicKey, plan, now: NOW + 1_000 });
  const action = {
    type: 118,
    calls: [{ to: RECIPIENT, value: "0x0", data: "0xa9059cbb00" }],
    fee_token: "0x3333333333333333333333333333333333333333",
  };
  const envelope = authorizeExecution({
    authorization,
    method: "eth_signTransaction",
    network: "eip155:8453",
    action,
  }, { privateKey, kid: "policy-execution", now: NOW, ttlMs: 60_000 });
  const execution = verifyExecutionAuthorization(envelope, {
    publicKey,
    authorization,
    method: "eth_signTransaction",
    network: "eip155:8453",
    action,
    now: NOW + 1_000,
  });
  assert.match(execution.actionBinding.digest, /^sha256:[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(execution), /a9059cbb/);
  const duplicateCall = { ...action, calls: [...action.calls, { ...action.calls[0] }] };
  assert.throws(() => verifyExecutionAuthorization(envelope, {
    publicKey,
    authorization,
    method: "eth_signTransaction",
    network: "eip155:8453",
    action: duplicateCall,
    now: NOW + 1_000,
  }), /exact authorized action/);
});

test("rejects execution method, network, payload, expiry, and unverified parent drift", () => {
  const plan = createPlan({ intent: intent(), offers: [offer()], now: NOW });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const planEnvelope = authorizePlan(plan, { privateKey, kid: "policy-plan", now: NOW });
  const authorization = verifyAuthorization(planEnvelope, { publicKey, plan, now: NOW + 1_000 });
  const action = { calls: [{ to: RECIPIENT, value: "0x0", data: "0x01" }] };
  const envelope = authorizeExecution({ authorization, method: "eth_signTransaction", network: "eip155:8453", action }, {
    privateKey,
    kid: "policy-execution",
    now: NOW,
    ttlMs: 60_000,
  });
  const verify = (overrides = {}) => verifyExecutionAuthorization(envelope, {
    publicKey,
    authorization,
    method: "eth_signTransaction",
    network: "eip155:8453",
    action,
    now: NOW + 1_000,
    ...overrides,
  });
  assert.throws(() => verify({ method: "personal_sign" }), /exact authorized action/);
  assert.throws(() => verify({ network: "eip155:1" }), /exact authorized action/);
  assert.throws(() => verify({ action: { ...action, calls: [{ ...action.calls[0], value: "0x1" }] } }), /exact authorized action/);
  assert.throws(() => verify({ now: NOW + 60_000 }), /not currently valid/);
  assert.throws(() => authorizeExecution({ authorization: { ...authorization }, method: "eth_signTransaction", network: "eip155:8453", action }, {
    privateKey,
    kid: "policy-execution",
    now: NOW,
  }), /verified plan authorization/);
});

test("carries public-safe exact execution evidence into the receipt", () => {
  const plan = createPlan({ intent: intent(), offers: [offer()], now: NOW });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const planEnvelope = authorizePlan(plan, { privateKey, kid: "policy-plan", now: NOW });
  const authorization = verifyAuthorization(planEnvelope, { publicKey, plan, now: NOW + 1_000 });
  const action = { calls: [{ to: RECIPIENT, value: "0x0", data: "0x01" }] };
  const executionEnvelope = authorizeExecution({ authorization, method: "eth_signTransaction", network: "eip155:8453", action }, {
    privateKey,
    kid: "policy-execution",
    now: NOW,
  });
  const executionAuthorization = verifyExecutionAuthorization(executionEnvelope, {
    publicKey,
    authorization,
    method: "eth_signTransaction",
    network: "eip155:8453",
    action,
    now: NOW + 1_000,
  });
  const receipt = createReceipt({
    plan,
    authorization,
    executionAuthorization,
    amountAtomic: "10000",
    transactionReference: "0xexecution",
    response: { data: { value: 42 } },
    now: NOW + 2_000,
  });
  assert.equal(receipt.execution.method, "eth_signTransaction");
  assert.equal(receipt.execution.network, "eip155:8453");
  assert.doesNotMatch(JSON.stringify(receipt), /0x01/);
  assert.throws(() => createReceipt({
    plan,
    authorization,
    executionAuthorization: { ...executionAuthorization },
    amountAtomic: "10000",
    transactionReference: "0xexecution",
    response: { data: { value: 42 } },
  }), /verified execution authorization/);
});

test("carries a JSON POST body digest through plan, authorization, and receipt", () => {
  const postOffer = offer({
    method: "POST",
    url: "https://seller.example/analyze",
    body: { domain: "buyer.example", types: ["A"] },
    mediaType: "application/json",
  });
  const plan = createPlan({ intent: intent(), offers: [postOffer], now: NOW });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const envelope = authorizePlan(plan, { privateKey, kid: "policy-post", now: NOW });
  const authorization = verifyAuthorization(envelope, { publicKey, plan, now: NOW + 1_000 });
  const receipt = createReceipt({ plan, authorization, amountAtomic: "10000", transactionReference: "0xpost", response: { data: { value: 42 } }, now: NOW + 2_000 });
  assert.equal(plan.selected.request.method, "POST");
  assert.match(plan.selected.request.bodyBinding.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(authorization.requestBindingDigest, plan.selected.request.bindingDigest);
  assert.deepEqual(receipt.request.bodyBinding, plan.selected.request.bodyBinding);
  assert.doesNotMatch(JSON.stringify({ plan, authorization, receipt }), /buyer\.example/);
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
