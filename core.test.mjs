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
  createWalletPolicyObservationDraft,
  evaluateWalletPolicyObservations,
  normalizeRequest,
  normalizeWalletPolicyObservations,
  verifyAuthorization,
  verifyExecutionAuthorization,
  PAYMENT_CONTROL_DIMENSIONS,
  WALLET_POLICY_OBSERVATION_CASES,
  STATEFUL_WALLET_POLICY_OBSERVATION_CASES,
  createStatefulWalletPolicyObservationDraft,
  evaluateStatefulWalletPolicyObservations,
  evaluateOfferCoherence,
  evaluateListingIdentity,
  normalizeStatefulWalletPolicyObservations,
  statefulWalletPolicyObservationInputSchema,
  statefulWalletPolicyObservationOutputSchema,
  offerCoherenceInputSchema,
  offerCoherenceOutputSchema,
  listingIdentityInputSchema,
  listingIdentityOutputSchema,
  walletPolicyObservationInputSchema,
  walletPolicyObservationOutputSchema,
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

function coherenceInput({ catalog = {}, runtime = {} } = {}) {
  return {
    schemaVersion: "agent-payment-policy.offer-coherence-observation.v1",
    catalog: {
      source: "coinbase-bazaar",
      protocol: "x402",
      method: "GET",
      url: "https://seller.example/data?asset=ETH",
      amountAtomic: "10000",
      network: "eip155:8453",
      asset: "USDC",
      recipient: RECIPIENT,
      expiresAt: new Date(NOW + 120_000).toISOString(),
      ...catalog,
    },
    runtime: {
      protocol: "x402",
      method: "GET",
      url: "https://seller.example/data?asset=ETH",
      amountAtomic: "10000",
      network: "eip155:8453",
      asset: "USDC",
      recipient: RECIPIENT,
      expiresAt: new Date(NOW + 120_000).toISOString(),
      ...runtime,
    },
  };
}

test("establishes complete catalog to live unsigned offer coherence without retaining query values", () => {
  const report = evaluateOfferCoherence(coherenceInput(), { now: NOW });
  assert.equal(report.schemaVersion, "agent-payment-policy.offer-coherence-report.v1");
  assert.equal(report.decision, "coherent");
  assert.equal(report.catalogCoherenceEstablished, true);
  assert.deepEqual(report.unknown, []);
  assert.deepEqual(report.drifted, []);
  assert.equal(report.dimensions.length, 7);
  assert.equal(report.nextAction, "eligible_for_separate_value_and_policy_authorization");
  assert.doesNotMatch(JSON.stringify(report), /ETH/);
  assert.equal(report.boundary.networkAccessed, false);
  assert.equal(report.boundary.paymentSent, false);
});

test("keeps absent catalog economics unknown rather than inventing agreement", () => {
  const input = coherenceInput();
  for (const field of ["protocol", "amountAtomic", "network", "asset", "recipient", "expiresAt"]) delete input.catalog[field];
  const report = evaluateOfferCoherence(input, { now: NOW });
  assert.equal(report.decision, "partial");
  assert.equal(report.catalogCoherenceEstablished, false);
  assert.deepEqual(report.matched, ["request"]);
  assert.deepEqual(report.unknown, ["protocol", "amount", "network", "asset", "recipient", "expiry"]);
  assert.equal(report.nextAction, "review_missing_catalog_terms_before_authorization");
});

test("reports every explicit catalog drift and requires a complete current runtime offer", () => {
  const report = evaluateOfferCoherence(coherenceInput({
    catalog: {
      url: "https://seller.example/data?asset=BTC",
      protocol: "mpp",
      amountAtomic: "50000",
      network: "eip155:1",
      asset: "OTHER",
      recipient: "0x3333333333333333333333333333333333333333",
      expiresAt: new Date(NOW + 60_000).toISOString(),
    },
  }), { now: NOW });
  assert.equal(report.decision, "drifted");
  assert.deepEqual(report.drifted, ["request", "protocol", "amount", "network", "asset", "recipient", "expiry"]);
  assert.equal(report.nextAction, "reject_or_refresh_stale_catalog_candidate");
  const incomplete = coherenceInput();
  delete incomplete.runtime.recipient;
  assert.throws(() => evaluateOfferCoherence(incomplete, { now: NOW }), /runtime recipient is required/);
  assert.throws(() => evaluateOfferCoherence(coherenceInput({ runtime: { expiresAt: new Date(NOW - 1).toISOString() } }), { now: NOW }), /expired/);
});

test("rejects unknown evidence fields and publishes strict coherence schemas", () => {
  assert.throws(() => evaluateOfferCoherence({ ...coherenceInput(), apiKey: "secret" }, { now: NOW }), /unsupported fields/);
  assert.throws(() => evaluateOfferCoherence(coherenceInput({ runtime: { source: "runtime" } }), { now: NOW }), /unsupported fields/);
  const inputSchema = offerCoherenceInputSchema();
  const outputSchema = offerCoherenceOutputSchema();
  assert.equal(inputSchema.properties.runtime.required.includes("recipient"), true);
  assert.equal(inputSchema.properties.catalog.required.includes("amountAtomic"), false);
  assert.equal(inputSchema.additionalProperties, false);
  assert.equal(outputSchema.properties.decision.enum.includes("drifted"), true);
  assert.equal(outputSchema.additionalProperties, false);
});

test("classifies canonical, duplicate, and settlement-linked alias records without retaining private identity values", () => {
  const secretSettlementIdentity = "0x2222222222222222222222222222222222222222";
  const report = evaluateListingIdentity({
    schemaVersion: "agent-payment-policy.listing-identity-observation.v1",
    target: {
      canonicalOrigin: "https://seller.example",
      route: "/data",
      settlementIdentity: secretSettlementIdentity,
    },
    records: [
      { source: "catalog-a", url: "https://seller.example/data?asset=PRIVATE_CANONICAL_VALUE", settlementIdentity: secretSettlementIdentity, rank: 1 },
      { source: "catalog-a", url: "https://legacy.example/data?asset=PRIVATE_ALIAS_VALUE", settlementIdentity: secretSettlementIdentity, rank: 2 },
      { source: "catalog-b", url: "https://seller.example/data", rank: 1 },
      { source: "catalog-b", url: "https://seller.example/data?copy=2", rank: 2 },
      { source: "catalog-c", url: "https://legacy.example/data", settlementIdentity: secretSettlementIdentity, rank: 1 },
    ],
  }, { now: NOW });
  assert.equal(report.schemaVersion, "agent-payment-policy.listing-identity-report.v1");
  assert.equal(report.decision, "review_required");
  assert.deepEqual(report.summary.conflictSources, ["catalog-a", "catalog-b", "catalog-c"]);
  assert.equal(report.sources.find(({ source }) => source === "catalog-a").status, "alias_collision");
  assert.equal(report.sources.find(({ source }) => source === "catalog-b").status, "duplicate_records");
  assert.equal(report.sources.find(({ source }) => source === "catalog-c").status, "alias_only");
  assert.equal(report.sources.find(({ source }) => source === "catalog-a").ownershipProven, false);
  assert.match(report.sources.find(({ source }) => source === "catalog-a").evidenceBoundary, /does not prove hostname ownership/);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_CANONICAL_VALUE|PRIVATE_ALIAS_VALUE|copy=2|0x2222222222222222222222222222222222222222/);
  assert.equal(report.boundary.networkAccessed, false);
  assert.equal(report.boundary.paymentSent, false);
});

test("permits canonical listing identity to advance only to separate runtime preflight", () => {
  const report = evaluateListingIdentity({
    schemaVersion: "agent-payment-policy.listing-identity-observation.v1",
    target: { canonicalOrigin: "https://seller.example", route: "/data" },
    records: [{ source: "catalog-a", url: "https://seller.example/data?asset=ETH", rank: 3 }],
  }, { now: NOW });
  assert.equal(report.decision, "canonical");
  assert.equal(report.nextAction, "eligible_for_separate_runtime_offer_preflight");
  assert.equal(report.sources[0].records[0].matchBasis, "canonical_origin");
  assert.equal(report.sources[0].canonicalOriginMatched, true);
  assert.equal(report.sources[0].ownershipProven, false);
  assert.match(report.sources[0].evidenceBoundary, /does not prove marketplace ownership/);
  assert.doesNotMatch(JSON.stringify(report), /ETH/);
});

test("distinguishes a declared empty catalog from a catalog that was not checked", () => {
  const report = evaluateListingIdentity({
    schemaVersion: "agent-payment-policy.listing-identity-observation.v1",
    target: { canonicalOrigin: "https://seller.example", route: "/data" },
    sources: ["empty-catalog"],
    records: [],
  }, { now: NOW });
  assert.equal(report.decision, "absent");
  assert.equal(report.summary.sourceCount, 1);
  assert.equal(report.sources[0].source, "empty-catalog");
  assert.equal(report.sources[0].status, "route_absent");
  assert.equal(report.sources[0].canonicalOriginMatched, false);
  assert.equal(report.sources[0].ownershipProven, false);
  assert.throws(() => evaluateListingIdentity({
    schemaVersion: "agent-payment-policy.listing-identity-observation.v1",
    target: { canonicalOrigin: "https://seller.example", route: "/data" },
    sources: ["duplicate", "duplicate"],
    records: [],
  }, { now: NOW }), /must not contain duplicates/);
});

test("fails closed on malformed listing identity evidence and publishes strict schemas", () => {
  const input = {
    schemaVersion: "agent-payment-policy.listing-identity-observation.v1",
    target: { canonicalOrigin: "https://seller.example", route: "/data" },
    records: [],
  };
  assert.throws(() => evaluateListingIdentity({ ...input, apiKey: "secret" }, { now: NOW }), /unsupported fields/);
  assert.throws(() => evaluateListingIdentity({ ...input, target: { canonicalOrigin: "https://seller.example/path", route: "/data" } }, { now: NOW }), /HTTPS origin/);
  assert.throws(() => evaluateListingIdentity({ ...input, target: { canonicalOrigin: "https://seller.example", route: "/data?x=1" } }, { now: NOW }), /exact absolute path/);
  assert.throws(() => evaluateListingIdentity({ ...input, records: [{ source: "catalog-a", url: "http://seller.example/data" }] }, { now: NOW }), /HTTPS/);
  const inputSchema = listingIdentityInputSchema();
  const outputSchema = listingIdentityOutputSchema();
  assert.equal(inputSchema.additionalProperties, false);
  assert.equal(inputSchema.properties.sources.uniqueItems, true);
  assert.equal(inputSchema.properties.records.maxItems, 100);
  assert.equal(outputSchema.properties.decision.enum.includes("review_required"), true);
  assert.equal(outputSchema.properties.target.additionalProperties, false);
  assert.equal(outputSchema.properties.sources.items.additionalProperties, false);
  assert.equal(outputSchema.properties.boundary.additionalProperties, false);
  assert.equal(outputSchema.additionalProperties, false);
});

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
  assert.equal(verified.summary.providerNeutralOnlyCount, 14);
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
  assert.equal(mixed.summary.providerNeutralOnlyCount, 8);

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

const walletObservation = (caseName, actual, denialClass = actual === "allowed" ? "none" : "policy") => ({
  case: caseName,
  actual,
  denialClass,
  code: actual === "allowed" ? "signed" : "policy_violation",
});

const completeWalletObservationMatrix = () => Object.entries(WALLET_POLICY_OBSERVATION_CASES)
  .filter(([, definition]) => definition.required)
  .map(([caseName, definition]) => walletObservation(caseName, definition.expected === "allow" ? "allowed" : "denied"));

const walletObservationInput = (observations = completeWalletObservationMatrix()) => ({
  schemaVersion: "agent-payment-policy.wallet-policy-observation.v1",
  profileId: "privy-solana-lab",
  provider: "Privy",
  network: "solana:mainnet",
  protocol: "x402",
  observations,
});

test("evaluates a complete explicit provider-policy matrix without an opaque score", () => {
  const report = evaluateWalletPolicyObservations(walletObservationInput(), { now: NOW });
  assert.equal(report.schemaVersion, "agent-payment-policy.wallet-policy-observation-report.v1");
  assert.equal(report.evaluatedAt, new Date(NOW).toISOString());
  assert.equal(report.decision, "conformant");
  assert.equal(report.complete, true);
  assert.equal(report.exactShapePassed, true);
  assert.equal(report.providerNativeVerified.length, 11);
  assert.equal("score" in report, false);
  assert.equal(report.boundary.walletAccessed, false);
});

test("reports duplicated approved action as unsafe execution shape", () => {
  const matrix = completeWalletObservationMatrix().map((row) =>
    row.case === "duplicate_approved_action" ? walletObservation(row.case, "allowed") : row,
  );
  const report = evaluateWalletPolicyObservations(walletObservationInput(matrix), { now: NOW });
  assert.equal(report.decision, "unsafe");
  assert.equal(report.exactShapePassed, false);
  assert.deepEqual(report.unsafeCases, ["duplicate_approved_action"]);
  assert.ok(report.providerNativeUnverified.includes("execution_shape"));
  assert.ok(!report.providerNativeVerified.includes("execution_shape"));
});

test("does not credit one passing shape probe when another observed shape probe fails", () => {
  const matrix = completeWalletObservationMatrix().map((row) =>
    row.case === "duplicate_approved_action" ? walletObservation(row.case, "allowed") : row,
  );
  matrix.push(walletObservation("missing_validity", "denied", "policy"));
  const report = evaluateWalletPolicyObservations(walletObservationInput(matrix), { now: NOW });
  assert.equal(report.exactShapePassed, false);
  assert.ok(!report.providerNativeVerified.includes("execution_shape"));
  assert.ok(report.providerNativeUnverified.includes("execution_shape"));
});

test("distinguishes a blocked intended action from an unrun intended action", () => {
  const denied = evaluateWalletPolicyObservations(walletObservationInput([
    walletObservation("intended", "denied", "policy"),
  ]), { now: NOW });
  assert.equal(denied.decision, "unsafe");
  assert.deepEqual(denied.unsafeCases, ["intended"]);

  const unrun = evaluateWalletPolicyObservations(walletObservationInput([
    walletObservation("intended", "error", "provider"),
  ]), { now: NOW });
  assert.equal(unrun.decision, "partial");
  assert.deepEqual(unrun.unsafeCases, []);
});

test("does not credit validation or generic provider failures as native policy", () => {
  const matrix = completeWalletObservationMatrix().map((row) => {
    if (row.case === "wrong_chain") return walletObservation(row.case, "error", "validation");
    if (row.case === "wrong_amount") return walletObservation(row.case, "denied", "provider");
    return row;
  });
  const report = evaluateWalletPolicyObservations(walletObservationInput(matrix), { now: NOW });
  assert.equal(report.decision, "partial");
  assert.ok(report.providerNativeUnverified.includes("chain"));
  assert.ok(report.providerNativeUnverified.includes("amount"));
  assert.ok(report.inconclusiveCases.includes("wrong_chain"));
  assert.ok(report.inconclusiveCases.includes("wrong_amount"));
});

test("normalizes only safe unique observations and rejects raw evidence fields", () => {
  const normalized = normalizeWalletPolicyObservations(walletObservationInput());
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.observations), true);
  assert.throws(() => normalizeWalletPolicyObservations({ ...walletObservationInput(), apiKey: "secret" }), /unsupported fields/);
  assert.throws(() => normalizeWalletPolicyObservations(walletObservationInput([
    walletObservation("intended", "allowed"),
    walletObservation("intended", "allowed"),
  ])), /duplicate case/);
  assert.throws(() => normalizeWalletPolicyObservations(walletObservationInput([{
    ...walletObservation("wrong_amount", "denied"),
    message: "raw provider response",
  }])), /unsupported fields/);
});

test("creates a valid safe draft whose untested cases remain partial", () => {
  const draft = createWalletPolicyObservationDraft({
    profileId: "provider-lab",
    provider: "Example Wallet",
    network: "eip155:8453",
    protocol: "x402",
  });
  assert.equal(draft.observations.length, 16);
  assert.ok(draft.observations.every((row) => row.actual === "error" && row.denialClass === "provider" && row.code === "not_tested"));
  const report = evaluateWalletPolicyObservations(draft, { now: NOW });
  assert.equal(report.decision, "partial");
  assert.equal(report.complete, true);
  assert.equal(report.providerNativeVerified.length, 0);
});

test("publishes strict input and output schemas for portable integrations", () => {
  const inputSchema = walletPolicyObservationInputSchema();
  const outputSchema = walletPolicyObservationOutputSchema();
  assert.equal(inputSchema.properties.schemaVersion.const, "agent-payment-policy.wallet-policy-observation.v1");
  assert.equal(inputSchema.properties.observations.maxItems, 16);
  assert.equal(inputSchema.additionalProperties, false);
  assert.equal(outputSchema.properties.schemaVersion.const, "agent-payment-policy.wallet-policy-observation-report.v1");
  assert.equal(outputSchema.additionalProperties, false);
});

const statefulObservation = (caseName, actual, enforcementClass = actual === "allowed" ? "none" : "policy") => ({
  case: caseName,
  actual,
  enforcementClass,
  code: actual === "allowed" ? "signed" : "policy_violation",
});

const completeStatefulMatrix = () => Object.entries(STATEFUL_WALLET_POLICY_OBSERVATION_CASES)
  .filter(([, definition]) => definition.required)
  .map(([caseName, definition]) => statefulObservation(caseName, definition.expected === "allow" ? "allowed" : "denied"));

const statefulInput = (observations = completeStatefulMatrix()) => ({
  schemaVersion: "agent-payment-policy.stateful-wallet-policy-observation.v1",
  profileId: "privy-base-sepolia-stateful",
  provider: "Privy",
  network: "eip155:11155111",
  protocol: "x402",
  observations,
});

test("evaluates a complete strict stateful budget matrix without an opaque score", () => {
  const report = evaluateStatefulWalletPolicyObservations(statefulInput(), { now: NOW });
  assert.equal(report.schemaVersion, "agent-payment-policy.stateful-wallet-policy-observation-report.v1");
  assert.equal(report.decision, "conformant");
  assert.equal(report.complete, true);
  assert.equal(report.strictBudgetPassed, true);
  assert.deepEqual(report.providerNativeVerified, [
    "cumulative_limit",
    "post_sign_accounting",
    "extraction_integrity",
    "concurrency",
    "reference_integrity",
  ]);
  assert.equal("score" in report, false);
});

test("reports extraction and concurrency allows as distinct unsafe cases", () => {
  const matrix = completeStatefulMatrix().map((row) => {
    if (["unrecognized_calldata", "concurrent_exceeds_cap"].includes(row.case)) {
      return statefulObservation(row.case, "allowed");
    }
    return row;
  });
  const report = evaluateStatefulWalletPolicyObservations(statefulInput(matrix), { now: NOW });
  assert.equal(report.decision, "unsafe");
  assert.equal(report.strictBudgetPassed, false);
  assert.deepEqual(report.unsafeCases, ["unrecognized_calldata", "concurrent_exceeds_cap"]);
  assert.ok(report.providerNativeUnverified.includes("extraction_integrity"));
  assert.ok(report.providerNativeUnverified.includes("concurrency"));
});

test("keeps application serialization separate from provider-native enforcement", () => {
  const matrix = completeStatefulMatrix();
  matrix.push(statefulObservation("application_serialized_concurrent_exceeds_cap", "denied", "application"));
  const report = evaluateStatefulWalletPolicyObservations(statefulInput(matrix), { now: NOW });
  assert.deepEqual(report.applicationVerified, ["application_serialization"]);
  assert.ok(!report.providerNativeVerified.includes("application_serialization"));
});

test("normalizes safe stateful observations and rejects raw or duplicate evidence", () => {
  const normalized = normalizeStatefulWalletPolicyObservations(statefulInput());
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.observations), true);
  assert.throws(() => normalizeStatefulWalletPolicyObservations({ ...statefulInput(), secret: "value" }), /unsupported fields/);
  assert.throws(() => normalizeStatefulWalletPolicyObservations(statefulInput([
    statefulObservation("first_within_cap", "allowed"),
    statefulObservation("first_within_cap", "allowed"),
  ])), /duplicate case/);
  assert.throws(() => normalizeStatefulWalletPolicyObservations(statefulInput([{
    ...statefulObservation("sequential_exceeds_cap", "denied"),
    rawResponse: "provider body",
  }])), /unsupported fields/);
});

test("creates and publishes the strict stateful draft and schemas", () => {
  const draft = createStatefulWalletPolicyObservationDraft({
    profileId: "stateful-lab",
    provider: "Example Wallet",
    network: "eip155:8453",
    protocol: "mpp",
  });
  assert.equal(draft.observations.length, 7);
  assert.ok(draft.observations.every((row) => row.actual === "error" && row.enforcementClass === "provider"));
  assert.equal(evaluateStatefulWalletPolicyObservations(draft, { now: NOW }).decision, "partial");
  const inputSchema = statefulWalletPolicyObservationInputSchema();
  const outputSchema = statefulWalletPolicyObservationOutputSchema();
  assert.equal(inputSchema.properties.observations.maxItems, 7);
  assert.equal(inputSchema.additionalProperties, false);
  assert.equal(outputSchema.properties.schemaVersion.const, "agent-payment-policy.stateful-wallet-policy-observation-report.v1");
  assert.equal(outputSchema.additionalProperties, false);
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
