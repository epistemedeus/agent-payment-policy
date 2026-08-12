import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { isIP } from "node:net";

export const SCHEMAS = Object.freeze({
  intent: "agent-payment-policy.intent.v1",
  plan: "agent-payment-policy.plan.v1",
  authorization: "agent-payment-policy.authorization.v1",
  authorizationJws: "agent-payment-policy.authorization-jws.v1",
  executionAuthorization: "agent-payment-policy.execution-authorization.v1",
  executionAuthorizationJws: "agent-payment-policy.execution-authorization-jws.v1",
  receipt: "agent-payment-policy.receipt.v1",
  controlCoverage: "agent-payment-policy.control-coverage.v2",
  walletPolicyObservation: "agent-payment-policy.wallet-policy-observation.v1",
  walletPolicyObservationReport: "agent-payment-policy.wallet-policy-observation-report.v1",
  statefulWalletPolicyObservation: "agent-payment-policy.stateful-wallet-policy-observation.v1",
  statefulWalletPolicyObservationReport: "agent-payment-policy.stateful-wallet-policy-observation-report.v1",
  offerCoherenceObservation: "agent-payment-policy.offer-coherence-observation.v1",
  offerCoherenceReport: "agent-payment-policy.offer-coherence-report.v1",
  listingIdentityObservation: "agent-payment-policy.listing-identity-observation.v1",
  listingIdentityReport: "agent-payment-policy.listing-identity-report.v1",
});

export const PAYMENT_CONTROL_DIMENSIONS = Object.freeze([
  "authorization",
  "operation",
  "execution_shape",
  "chain",
  "token_contract",
  "recipient",
  "amount",
  "function",
  "route_lock",
  "protocol_challenge",
  "replay",
  "output_contract",
  "receipt",
  "balance_reconciliation",
]);

const PRE_SIGNATURE_CONTROLS = new Set([
  "authorization",
  "operation",
  "execution_shape",
  "chain",
  "token_contract",
  "recipient",
  "amount",
  "function",
  "route_lock",
  "protocol_challenge",
  "replay",
]);

export const WALLET_POLICY_OBSERVATION_CASES = Object.freeze({
  intended: Object.freeze({ expected: "allow", control: null, required: true }),
  missing_authorization: Object.freeze({ expected: "deny", control: "authorization", required: true }),
  wrong_operation: Object.freeze({ expected: "deny", control: "operation", required: true }),
  duplicate_approved_action: Object.freeze({ expected: "deny", control: "execution_shape", required: true }),
  wrong_chain: Object.freeze({ expected: "deny", control: "chain", required: true }),
  wrong_token_contract_or_program: Object.freeze({ expected: "deny", control: "token_contract", required: true }),
  wrong_recipient: Object.freeze({ expected: "deny", control: "recipient", required: true }),
  wrong_amount: Object.freeze({ expected: "deny", control: "amount", required: true }),
  wrong_function_or_instruction: Object.freeze({ expected: "deny", control: "function", required: true }),
  wrong_route_or_offer: Object.freeze({ expected: "deny", control: "route_lock", required: true }),
  changed_protocol_challenge: Object.freeze({ expected: "deny", control: "protocol_challenge", required: true }),
  replay_or_reuse: Object.freeze({ expected: "deny", control: "replay", required: true }),
  reordered_approved_actions: Object.freeze({ expected: "deny", control: "execution_shape", required: false }),
  mixed_unapproved_action: Object.freeze({ expected: "deny", control: "execution_shape", required: false }),
  wrong_fee_asset: Object.freeze({ expected: "deny", control: "execution_shape", required: false }),
  missing_validity: Object.freeze({ expected: "deny", control: "execution_shape", required: false }),
});

export const WALLET_POLICY_OBSERVATION_CASE_NAMES = Object.freeze(Object.keys(WALLET_POLICY_OBSERVATION_CASES));
const REQUIRED_WALLET_POLICY_CASES = Object.freeze(
  Object.entries(WALLET_POLICY_OBSERVATION_CASES)
    .filter(([, definition]) => definition.required)
    .map(([name]) => name),
);
const WALLET_POLICY_OUTCOMES = new Set(["allowed", "denied", "error"]);
const WALLET_POLICY_DENIAL_CLASSES = new Set(["none", "policy", "validation", "provider"]);
const WALLET_POLICY_SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+ -]{0,127}$/;
const WALLET_POLICY_SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

export const STATEFUL_WALLET_POLICY_OBSERVATION_CASES = Object.freeze({
  first_within_cap: Object.freeze({ expected: "allow", control: null, required: true }),
  sequential_exceeds_cap: Object.freeze({ expected: "deny", control: "cumulative_limit", required: true }),
  signed_unbroadcast_counts: Object.freeze({ expected: "deny", control: "post_sign_accounting", required: true }),
  unrecognized_calldata: Object.freeze({ expected: "deny", control: "extraction_integrity", required: true }),
  concurrent_exceeds_cap: Object.freeze({ expected: "deny", control: "concurrency", required: true }),
  missing_counter_reference: Object.freeze({ expected: "deny", control: "reference_integrity", required: true }),
  application_serialized_concurrent_exceeds_cap: Object.freeze({ expected: "deny", control: "application_serialization", required: false }),
});
export const STATEFUL_WALLET_POLICY_OBSERVATION_CASE_NAMES = Object.freeze(
  Object.keys(STATEFUL_WALLET_POLICY_OBSERVATION_CASES),
);
export const STATEFUL_WALLET_POLICY_CONTROLS = Object.freeze([
  "cumulative_limit",
  "post_sign_accounting",
  "extraction_integrity",
  "concurrency",
  "reference_integrity",
  "application_serialization",
]);
const REQUIRED_STATEFUL_WALLET_POLICY_CASES = Object.freeze(
  Object.entries(STATEFUL_WALLET_POLICY_OBSERVATION_CASES)
    .filter(([, definition]) => definition.required)
    .map(([name]) => name),
);
const STATEFUL_ENFORCEMENT_CLASSES = new Set(["none", "policy", "application", "validation", "provider"]);
const OFFER_COHERENCE_DIMENSIONS = Object.freeze([
  "request",
  "protocol",
  "amount",
  "network",
  "asset",
  "recipient",
  "expiry",
]);
const OFFER_COHERENCE_SAFE_SOURCE = /^[A-Za-z0-9][A-Za-z0-9._:/+ -]{0,127}$/;

const CREDENTIAL_QUERY_KEY = /(?:^|[-_.])(api[-_.]?key|access[-_.]?token|auth|authorization|credential|password|secret|token)(?:$|[-_.])/i;
const PURPOSE_ID = /^[A-Za-z][A-Za-z0-9._:-]{2,127}$/;
const PROTOCOLS = new Set(["x402", "mpp"]);
const JSON_BODY_METHODS = new Set(["POST"]);
const VERIFIED_AUTHORIZATION = Symbol("verified-agent-payment-policy-authorization");
const VERIFIED_EXECUTION_AUTHORIZATION = Symbol("verified-agent-payment-policy-execution-authorization");

function fail(message) {
  throw new Error(message);
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function cleanString(value, max = 2_000) {
  const result = typeof value === "string" ? value.trim() : "";
  return result && result.length <= max ? result : null;
}

function controlSet(values, label) {
  if (!Array.isArray(values)) fail(`${label} must be an array`);
  const result = new Set();
  for (const value of values) {
    if (!PAYMENT_CONTROL_DIMENSIONS.includes(value)) fail(`${label} contains an unsupported control: ${value}`);
    if (result.has(value)) fail(`${label} contains a duplicate control: ${value}`);
    result.add(value);
  }
  return result;
}

function coverageIdentity(input) {
  const identity = {};
  for (const field of ["profileId", "provider", "network", "protocol"]) {
    const value = cleanString(input?.[field], 200);
    if (!value) fail(`control coverage ${field} is required`);
    identity[field] = value;
  }
  return identity;
}

export function createControlCoverage({
  profileId,
  provider,
  network,
  protocol,
  required = PAYMENT_CONTROL_DIMENSIONS,
  providerNativeVerified = [],
  providerNativeUnsupported = [],
  independentVerified = [],
} = {}) {
  const identity = coverageIdentity({ profileId, provider, network, protocol });
  const requiredSet = controlSet(required, "required");
  if (!requiredSet.size) fail("required must include at least one control");
  const native = controlSet(providerNativeVerified, "providerNativeVerified");
  const unsupported = controlSet(providerNativeUnsupported, "providerNativeUnsupported");
  const independent = controlSet(independentVerified, "independentVerified");
  for (const control of native) {
    if (unsupported.has(control)) fail(`provider-native status contradicts itself for ${control}`);
  }
  for (const evidence of [native, unsupported, independent]) {
    for (const control of evidence) {
      if (!requiredSet.has(control)) fail(`coverage evidence includes an unrequired control: ${control}`);
    }
  }

  const controls = [...requiredSet].map((control) => {
    const nativeVerified = native.has(control);
    const independentVerified = independent.has(control);
    let disposition = "uncovered";
    if (nativeVerified && independentVerified) disposition = "defense_in_depth";
    else if (nativeVerified) disposition = "provider_native_only";
    else if (independentVerified) disposition = "provider_neutral_only";
    return Object.freeze({
      control,
      phase: PRE_SIGNATURE_CONTROLS.has(control) ? "pre_signature" : "post_settlement",
      providerNative: nativeVerified ? "verified" : unsupported.has(control) ? "unsupported" : "unverified",
      independent: independentVerified ? "verified" : "unverified",
      disposition,
    });
  });
  const uncovered = controls.filter(({ disposition }) => disposition === "uncovered").map(({ control }) => control);
  const preSignatureUncovered = controls
    .filter(({ phase, disposition }) => phase === "pre_signature" && disposition === "uncovered")
    .map(({ control }) => control);
  const providerNeutralRequired = controls
    .filter(({ disposition }) => disposition === "provider_neutral_only")
    .map(({ control }) => control);
  const summary = Object.freeze({
    requiredCount: controls.length,
    defenseInDepthCount: controls.filter(({ disposition }) => disposition === "defense_in_depth").length,
    providerNativeOnlyCount: controls.filter(({ disposition }) => disposition === "provider_native_only").length,
    providerNeutralOnlyCount: providerNeutralRequired.length,
    uncoveredCount: uncovered.length,
    nativeCoverageComplete: controls.every(({ providerNative }) => providerNative === "verified"),
    crossLayerCoverageComplete: uncovered.length === 0,
    signingReady: preSignatureUncovered.length === 0,
    settlementReady: uncovered.length === 0,
  });
  return Object.freeze({
    schemaVersion: SCHEMAS.controlCoverage,
    ...identity,
    controls: Object.freeze(controls),
    summary,
    providerNeutralRequired: Object.freeze(providerNeutralRequired),
    uncovered: Object.freeze(uncovered),
    decision: uncovered.length === 0 ? "admit_with_declared_layers" : "reject_uncovered_control",
    boundary: "Coverage records enforcement placement. It does not prove that a provider or independent control is implemented correctly.",
  });
}

export function assertControlCoverage(report, {
  profileId,
  provider,
  network,
  protocol,
  required = PAYMENT_CONTROL_DIMENSIONS,
} = {}) {
  if (!record(report) || report.schemaVersion !== SCHEMAS.controlCoverage || !Array.isArray(report.controls)) {
    fail("control coverage report is missing or malformed");
  }
  const expectedIdentity = coverageIdentity({ profileId, provider, network, protocol });
  for (const field of Object.keys(expectedIdentity)) {
    if (cleanString(report[field], 200)?.toLowerCase() !== expectedIdentity[field].toLowerCase()) {
      fail(`control coverage ${field} does not match the expected profile`);
    }
  }
  const requiredSet = controlSet(required, "required");
  const observed = new Set(report.controls.map(({ control }) => control));
  if (observed.size !== report.controls.length || observed.size !== requiredSet.size ||
      [...requiredSet].some((control) => !observed.has(control))) {
    fail("control coverage does not exactly cover every required control");
  }
  const reconstructed = createControlCoverage({
    ...expectedIdentity,
    required: [...requiredSet],
    providerNativeVerified: report.controls.filter(({ providerNative }) => providerNative === "verified").map(({ control }) => control),
    providerNativeUnsupported: report.controls.filter(({ providerNative }) => providerNative === "unsupported").map(({ control }) => control),
    independentVerified: report.controls.filter(({ independent }) => independent === "verified").map(({ control }) => control),
  });
  for (const expected of reconstructed.controls) {
    const actual = report.controls.find(({ control }) => control === expected.control);
    if (!actual || canonicalJson(actual) !== canonicalJson(expected)) fail(`control coverage claims are inconsistent for ${expected.control}`);
  }
  if (reconstructed.decision !== "admit_with_declared_layers" ||
      !reconstructed.summary.signingReady || !reconstructed.summary.settlementReady ||
      reconstructed.uncovered.length !== 0) {
    fail("control coverage leaves one or more required controls uncovered");
  }
  return reconstructed;
}

function strictWalletPolicyRecord(value, label, allowedKeys) {
  if (!record(value)) fail(`${label} must be an object`);
  const extras = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (extras.length) fail(`${label} contains unsupported fields: ${extras.join(", ")}`);
  return value;
}

function walletPolicyIdentifier(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!WALLET_POLICY_SAFE_ID.test(normalized)) fail(`${label} must be 1-128 safe printable characters`);
  return normalized;
}

function normalizeWalletPolicyObservation(value, index) {
  const observation = strictWalletPolicyRecord(
    value,
    `observations[${index}]`,
    new Set(["case", "actual", "denialClass", "code"]),
  );
  if (!Object.hasOwn(WALLET_POLICY_OBSERVATION_CASES, observation.case)) {
    fail(`observations[${index}].case is unsupported`);
  }
  if (!WALLET_POLICY_OUTCOMES.has(observation.actual)) fail(`observations[${index}].actual is unsupported`);
  const denialClass = observation.denialClass ?? "none";
  if (!WALLET_POLICY_DENIAL_CLASSES.has(denialClass)) fail(`observations[${index}].denialClass is unsupported`);
  if (observation.actual === "allowed" && denialClass !== "none") {
    fail(`observations[${index}] allowed outcomes require denialClass none`);
  }
  if (observation.actual === "denied" && denialClass === "none") {
    fail(`observations[${index}] denied outcomes require an explicit denialClass`);
  }
  if (observation.actual === "error" && !["validation", "provider"].includes(denialClass)) {
    fail(`observations[${index}] error outcomes require validation or provider denialClass`);
  }
  if (observation.code !== undefined && (typeof observation.code !== "string" || !WALLET_POLICY_SAFE_CODE.test(observation.code))) {
    fail(`observations[${index}].code must be 1-64 safe identifier characters`);
  }
  return Object.freeze({
    case: observation.case,
    actual: observation.actual,
    denialClass,
    ...(observation.code ? { code: observation.code } : {}),
  });
}

export function normalizeWalletPolicyObservations(input) {
  const value = strictWalletPolicyRecord(
    input,
    "request",
    new Set(["schemaVersion", "profileId", "provider", "network", "protocol", "observations"]),
  );
  if (value.schemaVersion !== undefined && value.schemaVersion !== SCHEMAS.walletPolicyObservation) {
    fail(`unsupported wallet policy observation schema: ${value.schemaVersion}`);
  }
  if (!Array.isArray(value.observations) || value.observations.length < 1 || value.observations.length > 16) {
    fail("observations must contain 1-16 standardized cases");
  }
  const observations = value.observations.map(normalizeWalletPolicyObservation);
  const seen = new Set();
  for (const observation of observations) {
    if (seen.has(observation.case)) fail(`observations contains duplicate case: ${observation.case}`);
    seen.add(observation.case);
  }
  return Object.freeze({
    schemaVersion: SCHEMAS.walletPolicyObservation,
    profileId: walletPolicyIdentifier(value.profileId, "profileId"),
    provider: walletPolicyIdentifier(value.provider, "provider"),
    network: walletPolicyIdentifier(value.network, "network"),
    protocol: walletPolicyIdentifier(value.protocol, "protocol"),
    observations: Object.freeze(observations),
  });
}

function walletPolicyCaseDisposition(observation) {
  const definition = WALLET_POLICY_OBSERVATION_CASES[observation.case];
  const expectationMet = definition.expected === "allow"
    ? observation.actual === "allowed"
    : observation.actual === "denied";
  const providerNativeVerified = definition.control !== null
    && observation.actual === "denied"
    && observation.denialClass === "policy";
  let finding = "expected_behavior";
  if (!expectationMet) {
    finding = observation.actual === "allowed" ? "unsafe_allowed" : "expected_behavior_not_proven";
  } else if (definition.expected === "deny" && !providerNativeVerified) {
    finding = "denied_outside_provider_policy";
  }
  return Object.freeze({
    ...observation,
    expected: definition.expected,
    control: definition.control,
    required: definition.required,
    expectationMet,
    providerNativeVerified,
    finding,
  });
}

export function evaluateWalletPolicyObservations(input, { now = Date.now() } = {}) {
  if (!Number.isFinite(now)) fail("now must be a finite epoch millisecond value");
  const normalized = normalizeWalletPolicyObservations(input);
  const results = normalized.observations.map(walletPolicyCaseDisposition);
  const byCase = new Map(results.map((result) => [result.case, result]));
  const missingRequiredCases = REQUIRED_WALLET_POLICY_CASES.filter((name) => !byCase.has(name));
  const unsafeCases = results
    .filter((result) => result.finding === "unsafe_allowed" || (result.case === "intended" && result.actual === "denied"))
    .map((result) => result.case);
  const inconclusiveCases = results
    .filter((result) => result.finding === "expected_behavior_not_proven" || result.finding === "denied_outside_provider_policy")
    .map((result) => result.case);
  const preSignatureControls = PAYMENT_CONTROL_DIMENSIONS.filter((control) => PRE_SIGNATURE_CONTROLS.has(control));
  const executionShapeCases = results.filter((result) => result.control === "execution_shape");
  const exactShapePassed = executionShapeCases.length > 0
    && executionShapeCases.every((result) => result.providerNativeVerified)
    && byCase.has("duplicate_approved_action");
  const providerNativeVerified = preSignatureControls.filter((control) => {
    const controlResults = results.filter((result) => result.control === control);
    if (!controlResults.length || !controlResults.every((result) => result.providerNativeVerified)) return false;
    return control !== "execution_shape" || exactShapePassed;
  });
  const providerNativeUnverified = preSignatureControls.filter((control) => !providerNativeVerified.includes(control));
  const complete = missingRequiredCases.length === 0;
  let decision = "partial";
  if (unsafeCases.length) decision = "unsafe";
  else if (complete && inconclusiveCases.length === 0 && exactShapePassed) decision = "conformant";

  return Object.freeze({
    schemaVersion: SCHEMAS.walletPolicyObservationReport,
    evaluatedAt: new Date(now).toISOString(),
    profile: Object.freeze({
      profileId: normalized.profileId,
      provider: normalized.provider,
      network: normalized.network,
      protocol: normalized.protocol,
    }),
    decision,
    complete,
    exactShapePassed,
    results: Object.freeze(results),
    providerNativeVerified: Object.freeze(providerNativeVerified),
    providerNativeUnverified: Object.freeze(providerNativeUnverified),
    notEvaluatedByWalletPolicy: Object.freeze(["output_contract", "receipt", "balance_reconciliation"]),
    missingRequiredCases: Object.freeze(missingRequiredCases),
    unsafeCases: Object.freeze(unsafeCases),
    inconclusiveCases: Object.freeze(inconclusiveCases),
    boundary: Object.freeze({
      credentialsAccepted: false,
      walletAccessed: false,
      signatureVerified: false,
      transactionBroadcast: false,
      statement: "Evaluates caller-supplied standardized observations. It does not independently execute or verify provider policy tests.",
    }),
  });
}

export function createWalletPolicyObservationDraft({ profileId, provider, network, protocol } = {}) {
  const identity = {
    profileId: walletPolicyIdentifier(profileId, "profileId"),
    provider: walletPolicyIdentifier(provider, "provider"),
    network: walletPolicyIdentifier(network, "network"),
    protocol: walletPolicyIdentifier(protocol, "protocol"),
  };
  return Object.freeze({
    schemaVersion: SCHEMAS.walletPolicyObservation,
    ...identity,
    observations: Object.freeze(WALLET_POLICY_OBSERVATION_CASE_NAMES.map((caseName) => Object.freeze({
      case: caseName,
      actual: "error",
      denialClass: "provider",
      code: "not_tested",
    }))),
  });
}

export function walletPolicyObservationInputSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Agent payment wallet policy observations",
    type: "object",
    properties: {
      schemaVersion: { type: "string", const: SCHEMAS.walletPolicyObservation },
      profileId: { type: "string", minLength: 1, maxLength: 128 },
      provider: { type: "string", minLength: 1, maxLength: 128 },
      network: { type: "string", minLength: 1, maxLength: 128 },
      protocol: { type: "string", minLength: 1, maxLength: 128 },
      observations: {
        type: "array",
        minItems: 1,
        maxItems: 16,
        items: {
          type: "object",
          properties: {
            case: { type: "string", enum: [...WALLET_POLICY_OBSERVATION_CASE_NAMES] },
            actual: { type: "string", enum: ["allowed", "denied", "error"] },
            denialClass: { type: "string", enum: ["none", "policy", "validation", "provider"] },
            code: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$" },
          },
          required: ["case", "actual", "denialClass"],
          additionalProperties: false,
        },
      },
    },
    required: ["schemaVersion", "profileId", "provider", "network", "protocol", "observations"],
    additionalProperties: false,
  };
}

export function walletPolicyObservationOutputSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Agent payment wallet policy observation report",
    type: "object",
    properties: {
      schemaVersion: { type: "string", const: SCHEMAS.walletPolicyObservationReport },
      evaluatedAt: { type: "string", format: "date-time" },
      profile: { type: "object" },
      decision: { type: "string", enum: ["conformant", "partial", "unsafe"] },
      complete: { type: "boolean" },
      exactShapePassed: { type: "boolean" },
      results: { type: "array" },
      providerNativeVerified: { type: "array", items: { type: "string" } },
      providerNativeUnverified: { type: "array", items: { type: "string" } },
      notEvaluatedByWalletPolicy: { type: "array", items: { type: "string" } },
      missingRequiredCases: { type: "array", items: { type: "string" } },
      unsafeCases: { type: "array", items: { type: "string" } },
      inconclusiveCases: { type: "array", items: { type: "string" } },
      boundary: { type: "object" },
    },
    required: ["schemaVersion", "evaluatedAt", "profile", "decision", "complete", "exactShapePassed", "results", "providerNativeVerified", "providerNativeUnverified", "notEvaluatedByWalletPolicy", "missingRequiredCases", "unsafeCases", "inconclusiveCases", "boundary"],
    additionalProperties: false,
  };
}

function normalizeStatefulWalletPolicyObservation(value, index) {
  const observation = strictWalletPolicyRecord(
    value,
    `observations[${index}]`,
    new Set(["case", "actual", "enforcementClass", "code"]),
  );
  if (!Object.hasOwn(STATEFUL_WALLET_POLICY_OBSERVATION_CASES, observation.case)) {
    fail(`observations[${index}].case is unsupported`);
  }
  if (!WALLET_POLICY_OUTCOMES.has(observation.actual)) fail(`observations[${index}].actual is unsupported`);
  const enforcementClass = observation.enforcementClass ?? "none";
  if (!STATEFUL_ENFORCEMENT_CLASSES.has(enforcementClass)) fail(`observations[${index}].enforcementClass is unsupported`);
  if (observation.actual === "allowed" && enforcementClass !== "none") {
    fail(`observations[${index}] allowed outcomes require enforcementClass none`);
  }
  if (observation.actual === "denied" && enforcementClass === "none") {
    fail(`observations[${index}] denied outcomes require an explicit enforcementClass`);
  }
  if (observation.actual === "error" && !["validation", "provider"].includes(enforcementClass)) {
    fail(`observations[${index}] error outcomes require validation or provider enforcementClass`);
  }
  if (observation.code !== undefined && (typeof observation.code !== "string" || !WALLET_POLICY_SAFE_CODE.test(observation.code))) {
    fail(`observations[${index}].code must be 1-64 safe identifier characters`);
  }
  return Object.freeze({
    case: observation.case,
    actual: observation.actual,
    enforcementClass,
    ...(observation.code ? { code: observation.code } : {}),
  });
}

export function normalizeStatefulWalletPolicyObservations(input) {
  const value = strictWalletPolicyRecord(
    input,
    "request",
    new Set(["schemaVersion", "profileId", "provider", "network", "protocol", "observations"]),
  );
  if (value.schemaVersion !== undefined && value.schemaVersion !== SCHEMAS.statefulWalletPolicyObservation) {
    fail(`unsupported stateful wallet policy observation schema: ${value.schemaVersion}`);
  }
  if (!Array.isArray(value.observations) || value.observations.length < 1 || value.observations.length > 7) {
    fail("observations must contain 1-7 standardized stateful cases");
  }
  const observations = value.observations.map(normalizeStatefulWalletPolicyObservation);
  const seen = new Set();
  for (const observation of observations) {
    if (seen.has(observation.case)) fail(`observations contains duplicate case: ${observation.case}`);
    seen.add(observation.case);
  }
  return Object.freeze({
    schemaVersion: SCHEMAS.statefulWalletPolicyObservation,
    profileId: walletPolicyIdentifier(value.profileId, "profileId"),
    provider: walletPolicyIdentifier(value.provider, "provider"),
    network: walletPolicyIdentifier(value.network, "network"),
    protocol: walletPolicyIdentifier(value.protocol, "protocol"),
    observations: Object.freeze(observations),
  });
}

function statefulWalletPolicyCaseDisposition(observation) {
  const definition = STATEFUL_WALLET_POLICY_OBSERVATION_CASES[observation.case];
  const expectationMet = definition.expected === "allow"
    ? observation.actual === "allowed"
    : observation.actual === "denied";
  const providerNativeVerified = definition.control !== null
    && observation.actual === "denied"
    && observation.enforcementClass === "policy";
  const applicationVerified = definition.control !== null
    && observation.actual === "denied"
    && observation.enforcementClass === "application";
  let finding = "expected_behavior";
  if (!expectationMet) {
    finding = observation.actual === "allowed" ? "unsafe_allowed" : "expected_behavior_not_proven";
  } else if (definition.expected === "deny" && !providerNativeVerified && !applicationVerified) {
    finding = "denied_outside_policy_or_application_guard";
  }
  return Object.freeze({
    ...observation,
    expected: definition.expected,
    control: definition.control,
    required: definition.required,
    expectationMet,
    providerNativeVerified,
    applicationVerified,
    finding,
  });
}

export function evaluateStatefulWalletPolicyObservations(input, { now = Date.now() } = {}) {
  if (!Number.isFinite(now)) fail("now must be a finite epoch millisecond value");
  const normalized = normalizeStatefulWalletPolicyObservations(input);
  const results = normalized.observations.map(statefulWalletPolicyCaseDisposition);
  const byCase = new Map(results.map((result) => [result.case, result]));
  const missingRequiredCases = REQUIRED_STATEFUL_WALLET_POLICY_CASES.filter((name) => !byCase.has(name));
  const unsafeCases = results
    .filter((result) => result.finding === "unsafe_allowed" || (result.case === "first_within_cap" && result.actual === "denied"))
    .map((result) => result.case);
  const inconclusiveCases = results
    .filter((result) => result.finding === "expected_behavior_not_proven" || result.finding === "denied_outside_policy_or_application_guard")
    .map((result) => result.case);
  const providerNativeVerified = STATEFUL_WALLET_POLICY_CONTROLS.filter((control) => {
    const controlResults = results.filter((result) => result.control === control);
    return controlResults.length > 0 && controlResults.every((result) => result.providerNativeVerified);
  });
  const applicationVerified = STATEFUL_WALLET_POLICY_CONTROLS.filter((control) => {
    const controlResults = results.filter((result) => result.control === control);
    return controlResults.length > 0 && controlResults.every((result) => result.applicationVerified);
  });
  const requiredStrictControls = Object.freeze([
    "cumulative_limit",
    "post_sign_accounting",
    "extraction_integrity",
    "concurrency",
    "reference_integrity",
  ]);
  const providerNativeUnverified = requiredStrictControls.filter((control) => !providerNativeVerified.includes(control));
  const complete = missingRequiredCases.length === 0;
  let decision = "partial";
  if (unsafeCases.length) decision = "unsafe";
  else if (complete && inconclusiveCases.length === 0 && providerNativeUnverified.length === 0) decision = "conformant";
  return Object.freeze({
    schemaVersion: SCHEMAS.statefulWalletPolicyObservationReport,
    evaluatedAt: new Date(now).toISOString(),
    profile: Object.freeze({
      profileId: normalized.profileId,
      provider: normalized.provider,
      network: normalized.network,
      protocol: normalized.protocol,
    }),
    decision,
    complete,
    strictBudgetPassed: decision === "conformant",
    results: Object.freeze(results),
    providerNativeVerified: Object.freeze(providerNativeVerified),
    providerNativeUnverified: Object.freeze(providerNativeUnverified),
    applicationVerified: Object.freeze(applicationVerified),
    missingRequiredCases: Object.freeze(missingRequiredCases),
    unsafeCases: Object.freeze(unsafeCases),
    inconclusiveCases: Object.freeze(inconclusiveCases),
    boundary: Object.freeze({
      credentialsAccepted: false,
      walletAccessed: false,
      signaturesVerified: false,
      transactionBroadcast: false,
      statement: "Evaluates caller-supplied standardized stateful observations. It does not run concurrent requests, inspect provider counters, access a wallet, or verify signatures.",
    }),
  });
}

export function createStatefulWalletPolicyObservationDraft({ profileId, provider, network, protocol } = {}) {
  return Object.freeze({
    schemaVersion: SCHEMAS.statefulWalletPolicyObservation,
    profileId: walletPolicyIdentifier(profileId, "profileId"),
    provider: walletPolicyIdentifier(provider, "provider"),
    network: walletPolicyIdentifier(network, "network"),
    protocol: walletPolicyIdentifier(protocol, "protocol"),
    observations: Object.freeze(STATEFUL_WALLET_POLICY_OBSERVATION_CASE_NAMES.map((caseName) => Object.freeze({
      case: caseName,
      actual: "error",
      enforcementClass: "provider",
      code: "not_tested",
    }))),
  });
}

export function statefulWalletPolicyObservationInputSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Agent payment stateful wallet policy observations",
    type: "object",
    properties: {
      schemaVersion: { type: "string", const: SCHEMAS.statefulWalletPolicyObservation },
      profileId: { type: "string", minLength: 1, maxLength: 128 },
      provider: { type: "string", minLength: 1, maxLength: 128 },
      network: { type: "string", minLength: 1, maxLength: 128 },
      protocol: { type: "string", minLength: 1, maxLength: 128 },
      observations: {
        type: "array",
        minItems: 1,
        maxItems: 7,
        items: {
          type: "object",
          properties: {
            case: { type: "string", enum: [...STATEFUL_WALLET_POLICY_OBSERVATION_CASE_NAMES] },
            actual: { type: "string", enum: ["allowed", "denied", "error"] },
            enforcementClass: { type: "string", enum: ["none", "policy", "application", "validation", "provider"] },
            code: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$" },
          },
          required: ["case", "actual", "enforcementClass"],
          additionalProperties: false,
        },
      },
    },
    required: ["schemaVersion", "profileId", "provider", "network", "protocol", "observations"],
    additionalProperties: false,
  };
}

export function statefulWalletPolicyObservationOutputSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Agent payment stateful wallet policy observation report",
    type: "object",
    properties: {
      schemaVersion: { type: "string", const: SCHEMAS.statefulWalletPolicyObservationReport },
      evaluatedAt: { type: "string", format: "date-time" },
      profile: { type: "object" },
      decision: { type: "string", enum: ["conformant", "partial", "unsafe"] },
      complete: { type: "boolean" },
      strictBudgetPassed: { type: "boolean" },
      results: { type: "array" },
      providerNativeVerified: { type: "array", items: { type: "string" } },
      providerNativeUnverified: { type: "array", items: { type: "string" } },
      applicationVerified: { type: "array", items: { type: "string" } },
      missingRequiredCases: { type: "array", items: { type: "string" } },
      unsafeCases: { type: "array", items: { type: "string" } },
      inconclusiveCases: { type: "array", items: { type: "string" } },
      boundary: { type: "object" },
    },
    required: ["schemaVersion", "evaluatedAt", "profile", "decision", "complete", "strictBudgetPassed", "results", "providerNativeVerified", "providerNativeUnverified", "applicationVerified", "missingRequiredCases", "unsafeCases", "inconclusiveCases", "boundary"],
    additionalProperties: false,
  };
}

function atomic(value, label) {
  const text = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(text)) fail(`${label} must be a non-negative atomic integer`);
  return BigInt(text);
}

function strictRecord(value, label, allowedKeys) {
  if (!record(value)) fail(`${label} must be an object`);
  const extras = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (extras.length) fail(`${label} contains unsupported fields: ${extras.join(", ")}`);
  return value;
}

function normalizedComparable(value) {
  return String(value).toLowerCase();
}

function normalizeObservedOffer(value, { label, runtime, now }) {
  const allowedKeys = new Set(["protocol", "method", "url", "body", "mediaType", "amountAtomic", "network", "asset", "recipient", "expiresAt"]);
  if (!runtime) allowedKeys.add("source");
  const offer = strictRecord(
    value,
    label,
    allowedKeys,
  );
  const source = runtime ? "runtime" : cleanString(offer.source, 128);
  if (!runtime && (!source || !OFFER_COHERENCE_SAFE_SOURCE.test(source))) {
    fail("catalog source must be 1-128 safe printable characters");
  }
  const target = cleanString(offer.url, 2_048);
  if (!target) fail(`${label} url must be 1-2048 characters`);
  const request = normalizeRequest(
    offer.method,
    target,
    Object.prototype.hasOwnProperty.call(offer, "body")
      ? { body: offer.body, mediaType: offer.mediaType }
      : {},
  );
  const normalized = { source, request };
  const optionalFields = ["protocol", "amountAtomic", "network", "asset", "recipient", "expiresAt"];
  for (const field of optionalFields) {
    if (!runtime && (offer[field] === undefined || offer[field] === null || offer[field] === "")) continue;
    if (field === "protocol") {
      const protocol = String(offer.protocol || "").toLowerCase();
      if (!PROTOCOLS.has(protocol)) fail(`${label} protocol must be x402 or mpp`);
      normalized.protocol = protocol;
    } else if (field === "amountAtomic") {
      normalized.amountAtomic = String(atomic(offer.amountAtomic, `${label} amountAtomic`));
    } else if (field === "expiresAt") {
      const expiresAtMs = Date.parse(offer.expiresAt || "");
      if (!Number.isFinite(expiresAtMs)) fail(`${label} expiresAt must be a valid timestamp`);
      if (runtime && expiresAtMs <= now) fail("runtime offer is expired");
      normalized.expiresAt = new Date(expiresAtMs).toISOString();
    } else {
      const item = cleanString(offer[field], 200);
      if (!item) fail(`${label} ${field} is required`);
      normalized[field] = item;
    }
  }
  if (runtime) {
    for (const field of optionalFields) {
      if (!Object.prototype.hasOwnProperty.call(normalized, field)) fail(`runtime ${field} is required`);
    }
  }
  return Object.freeze(normalized);
}

function offerDimension(dimension, catalog, runtime) {
  let catalogValue;
  let runtimeValue;
  if (dimension === "request") {
    catalogValue = catalog.request.bindingDigest;
    runtimeValue = runtime.request.bindingDigest;
  } else if (dimension === "amount") {
    catalogValue = catalog.amountAtomic;
    runtimeValue = runtime.amountAtomic;
  } else if (dimension === "expiry") {
    catalogValue = catalog.expiresAt;
    runtimeValue = runtime.expiresAt;
  } else {
    catalogValue = catalog[dimension];
    runtimeValue = runtime[dimension];
  }
  const disposition = catalogValue === undefined
    ? "unknown"
    : normalizedComparable(catalogValue) === normalizedComparable(runtimeValue)
      ? "matched"
      : "drifted";
  return Object.freeze({
    dimension,
    disposition,
    catalog: catalogValue ?? null,
    runtime: runtimeValue,
  });
}

function publicObservedOffer(offer) {
  return Object.freeze({
    ...(offer.source ? { source: offer.source } : {}),
    request: Object.freeze({
      method: offer.request.method,
      origin: offer.request.origin,
      pathname: offer.request.pathname,
      queryKeys: Object.freeze([...offer.request.queryKeys]),
      publicRoute: offer.request.publicRoute,
      bodyBinding: offer.request.bodyBinding,
      bindingDigest: offer.request.bindingDigest,
    }),
    ...(offer.protocol ? { protocol: offer.protocol } : {}),
    ...(offer.amountAtomic ? { amountAtomic: offer.amountAtomic } : {}),
    ...(offer.network ? { network: offer.network } : {}),
    ...(offer.asset ? { asset: offer.asset } : {}),
    ...(offer.recipient ? { recipient: offer.recipient } : {}),
    ...(offer.expiresAt ? { expiresAt: offer.expiresAt } : {}),
  });
}

export function evaluateOfferCoherence(input, { now = Date.now() } = {}) {
  if (!Number.isFinite(now)) fail("now must be a finite epoch millisecond value");
  const value = strictRecord(input, "request", new Set(["schemaVersion", "catalog", "runtime"]));
  if (value.schemaVersion !== undefined && value.schemaVersion !== SCHEMAS.offerCoherenceObservation) {
    fail(`unsupported offer coherence schema: ${value.schemaVersion}`);
  }
  const catalog = normalizeObservedOffer(value.catalog, { label: "catalog", runtime: false, now });
  const runtime = normalizeObservedOffer(value.runtime, { label: "runtime", runtime: true, now });
  const dimensions = OFFER_COHERENCE_DIMENSIONS.map((dimension) => offerDimension(dimension, catalog, runtime));
  const drifted = dimensions.filter(({ disposition }) => disposition === "drifted").map(({ dimension }) => dimension);
  const unknown = dimensions.filter(({ disposition }) => disposition === "unknown").map(({ dimension }) => dimension);
  const matched = dimensions.filter(({ disposition }) => disposition === "matched").map(({ dimension }) => dimension);
  const decision = drifted.length ? "drifted" : unknown.length ? "partial" : "coherent";
  return Object.freeze({
    schemaVersion: SCHEMAS.offerCoherenceReport,
    evaluatedAt: new Date(now).toISOString(),
    source: catalog.source,
    decision,
    catalogCoherenceEstablished: decision === "coherent",
    runtimeOfferComplete: true,
    catalog: publicObservedOffer(catalog),
    runtime: publicObservedOffer(runtime),
    dimensions: Object.freeze(dimensions),
    matched: Object.freeze(matched),
    unknown: Object.freeze(unknown),
    drifted: Object.freeze(drifted),
    nextAction: decision === "coherent"
      ? "eligible_for_separate_value_and_policy_authorization"
      : decision === "partial"
        ? "review_missing_catalog_terms_before_authorization"
        : "reject_or_refresh_stale_catalog_candidate",
    boundary: Object.freeze({
      credentialsAccepted: false,
      networkAccessed: false,
      walletAccessed: false,
      paymentSigned: false,
      paymentSent: false,
      statement: "Compares caller-supplied catalog metadata with a caller-supplied live unsigned offer. It does not fetch, authenticate, authorize, sign, settle, or prove either source.",
    }),
  });
}

function offerObservationSchema({ runtime }) {
  const properties = {
    ...(runtime ? {} : { source: { type: "string", minLength: 1, maxLength: 128 } }),
    protocol: { type: "string", enum: ["x402", "mpp"] },
    method: { type: "string", pattern: "^[A-Za-z]{3,12}$" },
    url: { type: "string", format: "uri", maxLength: 2048 },
    body: { oneOf: [{ type: "object" }, { type: "array" }] },
    mediaType: { type: "string", const: "application/json" },
    amountAtomic: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,77})$" },
    network: { type: "string", minLength: 1, maxLength: 200 },
    asset: { type: "string", minLength: 1, maxLength: 200 },
    recipient: { type: "string", minLength: 1, maxLength: 200 },
    expiresAt: { type: "string", format: "date-time" },
  };
  return {
    type: "object",
    properties,
    required: runtime
      ? ["protocol", "method", "url", "amountAtomic", "network", "asset", "recipient", "expiresAt"]
      : ["source", "method", "url"],
    additionalProperties: false,
  };
}

export function offerCoherenceInputSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Agent payment catalog to runtime offer coherence observation",
    type: "object",
    properties: {
      schemaVersion: { type: "string", const: SCHEMAS.offerCoherenceObservation },
      catalog: offerObservationSchema({ runtime: false }),
      runtime: offerObservationSchema({ runtime: true }),
    },
    required: ["schemaVersion", "catalog", "runtime"],
    additionalProperties: false,
  };
}

export function offerCoherenceOutputSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Agent payment catalog to runtime offer coherence report",
    type: "object",
    properties: {
      schemaVersion: { type: "string", const: SCHEMAS.offerCoherenceReport },
      evaluatedAt: { type: "string", format: "date-time" },
      source: { type: "string" },
      decision: { type: "string", enum: ["coherent", "partial", "drifted"] },
      catalogCoherenceEstablished: { type: "boolean" },
      runtimeOfferComplete: { type: "boolean", const: true },
      catalog: { type: "object" },
      runtime: { type: "object" },
      dimensions: { type: "array" },
      matched: { type: "array", items: { type: "string", enum: [...OFFER_COHERENCE_DIMENSIONS] } },
      unknown: { type: "array", items: { type: "string", enum: [...OFFER_COHERENCE_DIMENSIONS] } },
      drifted: { type: "array", items: { type: "string", enum: [...OFFER_COHERENCE_DIMENSIONS] } },
      nextAction: { type: "string" },
      boundary: { type: "object" },
    },
    required: ["schemaVersion", "evaluatedAt", "source", "decision", "catalogCoherenceEstablished", "runtimeOfferComplete", "catalog", "runtime", "dimensions", "matched", "unknown", "drifted", "nextAction", "boundary"],
    additionalProperties: false,
  };
}

function normalizeListingTarget(value) {
  const target = strictRecord(value, "target", new Set(["canonicalOrigin", "route", "settlementIdentity"]));
  const originText = cleanString(target.canonicalOrigin, 253);
  let origin;
  try {
    origin = new URL(originText);
  } catch {
    fail("target canonicalOrigin must be a valid HTTPS origin");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    fail("target canonicalOrigin must be an HTTPS origin without path, query, fragment, or credentials");
  }
  const route = cleanString(target.route, 200);
  if (!route || !/^\/[^?#]*$/.test(route) || route.startsWith("//") || route.includes("..")) {
    fail("target route must be an exact absolute path without query, fragment, or traversal");
  }
  const settlementIdentity = target.settlementIdentity === undefined
    ? null
    : cleanString(target.settlementIdentity, 200);
  if (target.settlementIdentity !== undefined && !settlementIdentity) {
    fail("target settlementIdentity must be 1-200 characters when supplied");
  }
  return Object.freeze({ canonicalOrigin: origin.origin, route, settlementIdentity });
}

function normalizeListingRecord(value, index) {
  const item = strictRecord(value, `record ${index}`, new Set(["source", "url", "settlementIdentity", "rank"]));
  const source = cleanString(item.source, 128);
  if (!source || !OFFER_COHERENCE_SAFE_SOURCE.test(source)) {
    fail(`record ${index} source must be 1-128 safe printable characters`);
  }
  const request = normalizeRequest("GET", item.url);
  const settlementIdentity = item.settlementIdentity === undefined
    ? null
    : cleanString(item.settlementIdentity, 200);
  if (item.settlementIdentity !== undefined && !settlementIdentity) {
    fail(`record ${index} settlementIdentity must be 1-200 characters when supplied`);
  }
  const rank = item.rank === undefined ? index + 1 : Number(item.rank);
  if (!Number.isInteger(rank) || rank < 1 || rank > 1_000_000) {
    fail(`record ${index} rank must be an integer from 1 through 1000000`);
  }
  return Object.freeze({ source, request, settlementIdentity, rank });
}

function listingIdentitySourceReport(source, records, target) {
  const sameRoute = records.filter((record) => record.request.pathname === target.route);
  const relevant = sameRoute.filter((record) => record.request.origin === target.canonicalOrigin
    || (target.settlementIdentity !== null && record.settlementIdentity === target.settlementIdentity));
  const canonical = relevant.filter((record) => record.request.origin === target.canonicalOrigin);
  const aliases = relevant.filter((record) => record.request.origin !== target.canonicalOrigin);
  const aliasOrigins = [...new Set(aliases.map((record) => record.request.origin))].sort();
  let status = "canonical";
  if (!relevant.length) status = "route_absent";
  else if (relevant.length > 1) status = aliasOrigins.length ? "alias_collision" : "duplicate_records";
  else if (!canonical.length && aliasOrigins.length) status = "alias_only";
  const publicRecords = relevant
    .map((record) => Object.freeze({
      rank: record.rank,
      origin: record.request.origin,
      pathname: record.request.pathname,
      matchBasis: record.request.origin === target.canonicalOrigin ? "canonical_origin" : "settlement_identity",
    }))
    .sort((left, right) => left.rank - right.rank || left.origin.localeCompare(right.origin));
  return Object.freeze({
    source,
    status,
    exactRouteRecordCount: relevant.length,
    canonicalRecordCount: canonical.length,
    canonicalOriginMatched: canonical.length > 0,
    aliasCandidateCount: aliases.length,
    aliasOrigins: Object.freeze(aliasOrigins),
    records: Object.freeze(publicRecords),
    ownershipProven: false,
    evidenceBoundary: aliasOrigins.length
      ? "A non-canonical record matched the caller-supplied settlement identity and exact route. This links advertised settlement identity but does not prove hostname ownership."
      : "An observed record uses the caller-supplied canonical origin. This does not prove marketplace ownership or control.",
  });
}

export function evaluateListingIdentity(input, { now = Date.now() } = {}) {
  if (!Number.isFinite(now)) fail("now must be a finite epoch millisecond value");
  const value = strictRecord(input, "request", new Set(["schemaVersion", "target", "sources", "records"]));
  if (value.schemaVersion !== undefined && value.schemaVersion !== SCHEMAS.listingIdentityObservation) {
    fail(`unsupported listing identity schema: ${value.schemaVersion}`);
  }
  const target = normalizeListingTarget(value.target);
  if (!Array.isArray(value.records) || value.records.length > 100) {
    fail("records must be an array with at most 100 entries");
  }
  if (value.sources !== undefined && (!Array.isArray(value.sources) || value.sources.length > 100)) {
    fail("sources must be an array with at most 100 entries when supplied");
  }
  const records = value.records.map((record, index) => normalizeListingRecord(record, index));
  const declaredSources = (value.sources ?? []).map((source, index) => {
    const normalized = cleanString(source, 128);
    if (!normalized || !OFFER_COHERENCE_SAFE_SOURCE.test(normalized)) {
      fail(`source ${index} must be 1-128 safe printable characters`);
    }
    return normalized;
  });
  if (new Set(declaredSources).size !== declaredSources.length) {
    fail("sources must not contain duplicates");
  }
  const sources = [...new Set([...declaredSources, ...records.map((record) => record.source)])].sort();
  const reports = sources.map((source) => listingIdentitySourceReport(
    source,
    records.filter((record) => record.source === source),
    target,
  ));
  const conflicts = reports.filter((report) => ["duplicate_records", "alias_only", "alias_collision"].includes(report.status));
  const found = reports.filter((report) => report.status !== "route_absent");
  const decision = conflicts.length ? "review_required" : found.length ? "canonical" : "absent";
  return Object.freeze({
    schemaVersion: SCHEMAS.listingIdentityReport,
    evaluatedAt: new Date(now).toISOString(),
    target: Object.freeze({
      canonicalOrigin: target.canonicalOrigin,
      route: target.route,
      settlementIdentitySupplied: target.settlementIdentity !== null,
    }),
    decision,
    summary: Object.freeze({
      sourceCount: reports.length,
      foundSourceCount: found.length,
      conflictSourceCount: conflicts.length,
      conflictSources: Object.freeze(conflicts.map((report) => report.source)),
    }),
    sources: Object.freeze(reports),
    nextAction: decision === "review_required"
      ? "preserve_canonical_record_and_verify_alias_ownership_before_change"
      : decision === "canonical"
        ? "eligible_for_separate_runtime_offer_preflight"
        : "verify_listing_or_choose_another_supplier",
    boundary: Object.freeze({
      credentialsAccepted: false,
      networkAccessed: false,
      walletAccessed: false,
      paymentSigned: false,
      paymentSent: false,
      queryValuesRetained: false,
      settlementIdentityRetained: false,
      statement: "Evaluates caller-supplied catalog listing identity. Shared settlement identity links records but does not prove hostname ownership, seller control, demand, or runtime payment terms.",
    }),
  });
}

function listingIdentityRecordSchema() {
  return {
    type: "object",
    properties: {
      source: { type: "string", minLength: 1, maxLength: 128 },
      url: { type: "string", format: "uri", maxLength: 2048 },
      settlementIdentity: { type: "string", minLength: 1, maxLength: 200 },
      rank: { type: "integer", minimum: 1, maximum: 1_000_000 },
    },
    required: ["source", "url"],
    additionalProperties: false,
  };
}

export function listingIdentityInputSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Agent payment catalog listing identity observation",
    type: "object",
    properties: {
      schemaVersion: { type: "string", const: SCHEMAS.listingIdentityObservation },
      target: {
        type: "object",
        properties: {
          canonicalOrigin: { type: "string", format: "uri", maxLength: 253 },
          route: { type: "string", pattern: "^/[^?#]*$", maxLength: 200 },
          settlementIdentity: { type: "string", minLength: 1, maxLength: 200 },
        },
        required: ["canonicalOrigin", "route"],
        additionalProperties: false,
      },
      sources: {
        type: "array",
        maxItems: 100,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 128 },
      },
      records: { type: "array", maxItems: 100, items: listingIdentityRecordSchema() },
    },
    required: ["schemaVersion", "target", "records"],
    additionalProperties: false,
  };
}

export function listingIdentityOutputSchema() {
  const publicRecord = {
    type: "object",
    properties: {
      rank: { type: "integer", minimum: 1, maximum: 1_000_000 },
      origin: { type: "string", format: "uri" },
      pathname: { type: "string" },
      matchBasis: { type: "string", enum: ["canonical_origin", "settlement_identity"] },
    },
    required: ["rank", "origin", "pathname", "matchBasis"],
    additionalProperties: false,
  };
  const sourceReport = {
    type: "object",
    properties: {
      source: { type: "string" },
      status: { type: "string", enum: ["canonical", "duplicate_records", "alias_only", "alias_collision", "route_absent"] },
      exactRouteRecordCount: { type: "integer", minimum: 0 },
      canonicalRecordCount: { type: "integer", minimum: 0 },
      canonicalOriginMatched: { type: "boolean" },
      aliasCandidateCount: { type: "integer", minimum: 0 },
      aliasOrigins: { type: "array", uniqueItems: true, items: { type: "string", format: "uri" } },
      records: { type: "array", items: publicRecord },
      ownershipProven: { type: "boolean", const: false },
      evidenceBoundary: { type: "string" },
    },
    required: ["source", "status", "exactRouteRecordCount", "canonicalRecordCount", "canonicalOriginMatched", "aliasCandidateCount", "aliasOrigins", "records", "ownershipProven", "evidenceBoundary"],
    additionalProperties: false,
  };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Agent payment catalog listing identity report",
    type: "object",
    properties: {
      schemaVersion: { type: "string", const: SCHEMAS.listingIdentityReport },
      evaluatedAt: { type: "string", format: "date-time" },
      target: {
        type: "object",
        properties: {
          canonicalOrigin: { type: "string", format: "uri" },
          route: { type: "string" },
          settlementIdentitySupplied: { type: "boolean" },
        },
        required: ["canonicalOrigin", "route", "settlementIdentitySupplied"],
        additionalProperties: false,
      },
      decision: { type: "string", enum: ["canonical", "review_required", "absent"] },
      summary: {
        type: "object",
        properties: {
          sourceCount: { type: "integer", minimum: 0 },
          foundSourceCount: { type: "integer", minimum: 0 },
          conflictSourceCount: { type: "integer", minimum: 0 },
          conflictSources: { type: "array", uniqueItems: true, items: { type: "string" } },
        },
        required: ["sourceCount", "foundSourceCount", "conflictSourceCount", "conflictSources"],
        additionalProperties: false,
      },
      sources: { type: "array", items: sourceReport },
      nextAction: { type: "string" },
      boundary: {
        type: "object",
        properties: {
          credentialsAccepted: { type: "boolean", const: false },
          networkAccessed: { type: "boolean", const: false },
          walletAccessed: { type: "boolean", const: false },
          paymentSigned: { type: "boolean", const: false },
          paymentSent: { type: "boolean", const: false },
          queryValuesRetained: { type: "boolean", const: false },
          settlementIdentityRetained: { type: "boolean", const: false },
          statement: { type: "string" },
        },
        required: ["credentialsAccepted", "networkAccessed", "walletAccessed", "paymentSigned", "paymentSent", "queryValuesRetained", "settlementIdentityRetained", "statement"],
        additionalProperties: false,
      },
    },
    required: ["schemaVersion", "evaluatedAt", "target", "decision", "summary", "sources", "nextAction", "boundary"],
    additionalProperties: false,
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (record(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

export function digest(value) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex")}`;
}

function assertJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("request body contains a non-finite number");
    return;
  }
  if (typeof value !== "object") fail("request body is not JSON compatible");
  if (seen.has(value)) fail("request body contains a cycle");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, seen);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("request body must contain only plain objects and arrays");
    for (const item of Object.values(value)) assertJsonValue(item, seen);
  }
  seen.delete(value);
}

export function canonicalRequestBody(value) {
  if (!record(value) && !Array.isArray(value)) fail("request body must be a JSON object or array");
  assertJsonValue(value);
  const serialized = canonicalJson(value);
  const bytes = Buffer.byteLength(serialized);
  if (bytes < 1 || bytes > 1_000_000) fail("request body must be between 1 and 1000000 bytes");
  return serialized;
}

function publicIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && c <= 2))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function publicIpv6(address) {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return false;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return false;
  if (/^fe[89ab]/.test(lower)) return false;
  if (lower.startsWith("ff")) return false;
  if (lower.startsWith("2001:db8")) return false;
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice(7);
    return isIP(mapped) === 4 && publicIpv4(mapped);
  }
  return /^[23]/.test(lower);
}

export function assertPublicAddress(address) {
  const text = cleanString(address, 128);
  const family = text ? isIP(text) : 0;
  if (family === 4 && publicIpv4(text)) return text;
  if (family === 6 && publicIpv6(text)) return text;
  fail("resolved address is private, local, reserved, or invalid");
}

export function assertResolvedPublicAddresses(addresses) {
  if (!Array.isArray(addresses) || !addresses.length) fail("at least one resolved address is required");
  return addresses.map((entry) => assertPublicAddress(typeof entry === "string" ? entry : entry?.address));
}

export function normalizeRequest(method, target, options = {}) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (!/^[A-Z]{3,12}$/.test(normalizedMethod)) fail("request method is invalid");
  const requestOptions = record(options) || {};
  const hasBody = Object.prototype.hasOwnProperty.call(requestOptions, "body");
  if (JSON_BODY_METHODS.has(normalizedMethod) && !hasBody) fail(`${normalizedMethod} request body is required`);
  if (!JSON_BODY_METHODS.has(normalizedMethod) && hasBody) fail(`${normalizedMethod} request body is not supported`);
  let bodyBinding = null;
  if (hasBody) {
    const mediaType = (cleanString(requestOptions.mediaType, 200) || "application/json").toLowerCase();
    if (mediaType !== "application/json") fail("request body mediaType must be application/json");
    const serialized = canonicalRequestBody(requestOptions.body);
    bodyBinding = Object.freeze({
      mediaType,
      bytes: Buffer.byteLength(serialized),
      digest: digest(serialized),
    });
  }
  let url;
  try {
    url = new URL(target);
  } catch {
    fail("request target is not a valid URL");
  }
  if (url.protocol !== "https:") fail("request target must use HTTPS");
  if (url.username || url.password) fail("request target must not contain user information");
  if (url.port && url.port !== "443") fail("request target must use the default HTTPS port");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa")) {
    fail("request target hostname is local or private");
  }
  if (isIP(hostname)) assertPublicAddress(hostname);
  const queryKeys = [...new Set(url.searchParams.keys())].sort();
  if (queryKeys.some((key) => CREDENTIAL_QUERY_KEY.test(key))) fail("request target contains a credential-like query key");
  const privateBinding = bodyBinding
    ? canonicalJson({ method: normalizedMethod, target: url.toString(), bodyBinding })
    : `${normalizedMethod} ${url.toString()}`;
  return Object.freeze({
    method: normalizedMethod,
    origin: url.origin,
    pathname: url.pathname,
    queryKeys,
    publicRoute: `${normalizedMethod} ${url.origin}${url.pathname}`,
    bodyBinding,
    bindingDigest: digest(privateBinding),
  });
}

function normalizeOutput(output) {
  if (!record(output)) fail("output contract is required");
  const mediaType = cleanString(output.mediaType, 200) || "application/json";
  const requiredFields = Array.isArray(output.requiredFields)
    ? [...new Set(output.requiredFields.map((field) => cleanString(field, 200)).filter(Boolean))].sort()
    : [];
  const maxResponseBytes = Number(output.maxResponseBytes ?? 100_000);
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 10_000_000) {
    fail("output maxResponseBytes is invalid");
  }
  return { mediaType, requiredFields, maxResponseBytes };
}

function normalizeOrigins(origins) {
  if (!Array.isArray(origins)) return [];
  return [...new Set(origins.map((value) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      fail("owned origin must be an HTTPS origin without a path, query, or user information");
    }
    return url.origin;
  }))].sort();
}

export function createIntent(input, { now = Date.now(), ttlMs = 3_600_000 } = {}) {
  if (!record(input)) fail("intent input is required");
  const purposeId = cleanString(input.purposeId, 128);
  if (!purposeId || !PURPOSE_ID.test(purposeId)) fail("purposeId is invalid");
  const need = cleanString(input.need, 20_000);
  const needDigest = cleanString(input.needDigest, 80) || (need ? digest(need) : null);
  if (!/^sha256:[0-9a-f]{64}$/.test(needDigest || "")) fail("need or needDigest is required");
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 86_400_000) fail("intent ttlMs is invalid");
  const economics = record(input.economics) || {};
  const expectedValueAtomic = atomic(economics.expectedValueAtomic, "expectedValueAtomic");
  const integrationCostAtomic = atomic(economics.integrationCostAtomic ?? 0, "integrationCostAtomic");
  const verificationCostAtomic = atomic(economics.verificationCostAtomic ?? 0, "verificationCostAtomic");
  const riskReserveAtomic = atomic(economics.riskReserveAtomic ?? 0, "riskReserveAtomic");
  const maxTotalCostAtomic = atomic(economics.maxTotalCostAtomic, "maxTotalCostAtomic");
  const policy = record(input.policy) || {};
  const maxAtomic = atomic(policy.maxAtomic, "policy.maxAtomic");
  const dailyCapAtomic = atomic(policy.dailyCapAtomic, "policy.dailyCapAtomic");
  const allowedProtocols = [...new Set((policy.allowedProtocols || ["x402", "mpp"]).map(String))];
  if (!allowedProtocols.length || allowedProtocols.some((item) => !PROTOCOLS.has(item))) fail("allowedProtocols is invalid");
  const protocolPreference = [...new Set((policy.protocolPreference || allowedProtocols).map(String))];
  if (protocolPreference.length !== allowedProtocols.length || protocolPreference.some((item) => !allowedProtocols.includes(item))) {
    fail("protocolPreference must contain every allowed protocol exactly once");
  }
  const intent = {
    schemaVersion: SCHEMAS.intent,
    purposeId,
    needDigest,
    output: normalizeOutput(input.output),
    economics: {
      expectedValueAtomic: String(expectedValueAtomic),
      integrationCostAtomic: String(integrationCostAtomic),
      verificationCostAtomic: String(verificationCostAtomic),
      riskReserveAtomic: String(riskReserveAtomic),
      maxTotalCostAtomic: String(maxTotalCostAtomic),
    },
    policy: {
      maxAtomic: String(maxAtomic),
      dailyCapAtomic: String(dailyCapAtomic),
      allowedProtocols,
      protocolPreference,
      buyerAddress: cleanString(policy.buyerAddress, 200),
      ownedOrigins: normalizeOrigins(policy.ownedOrigins),
    },
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  return Object.freeze({ ...intent, intentId: digest(intent) });
}

function normalizeOffer(offer, intent, now) {
  if (!record(offer)) fail("offer is required");
  const protocol = String(offer.protocol || "");
  if (!intent.policy.allowedProtocols.includes(protocol)) fail("offer protocol is not allowed");
  const request = normalizeRequest(offer.method, offer.url, Object.prototype.hasOwnProperty.call(offer, "body")
    ? { body: offer.body, mediaType: offer.mediaType }
    : {});
  if (intent.policy.ownedOrigins.includes(request.origin)) fail("owned supply is excluded");
  const recipient = cleanString(offer.recipient, 200);
  if (!recipient) fail("offer recipient is required");
  if (intent.policy.buyerAddress && recipient.toLowerCase() === intent.policy.buyerAddress.toLowerCase()) fail("self-payment is excluded");
  const amountAtomic = atomic(offer.amountAtomic, "offer amountAtomic");
  if (amountAtomic > atomic(intent.policy.maxAtomic, "policy maxAtomic")) fail("offer exceeds the per-call cap");
  const expiresAtMs = Date.parse(offer.expiresAt || "");
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) fail("offer is stale or has no expiry");
  const network = cleanString(offer.network, 200);
  const asset = cleanString(offer.asset, 200);
  if (!network) fail("offer network is required");
  if (!asset) fail("offer asset is required");
  return {
    protocol,
    request,
    amountAtomic: String(amountAtomic),
    network,
    asset,
    recipient,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function createPlan({ intent, offers, spentTodayAtomic = "0", now = Date.now() } = {}) {
  if (!record(intent) || intent.schemaVersion !== SCHEMAS.intent || intent.intentId !== digest(Object.fromEntries(Object.entries(intent).filter(([key]) => key !== "intentId")))) {
    fail("intent is invalid or has been modified");
  }
  if (Date.parse(intent.expiresAt) <= now) fail("intent is expired");
  const spent = atomic(spentTodayAtomic, "spentTodayAtomic");
  const dailyCap = atomic(intent.policy.dailyCapAtomic, "daily cap");
  const killed = [];
  const viable = [];
  for (const [index, rawOffer] of (Array.isArray(offers) ? offers : []).entries()) {
    try {
      const offer = normalizeOffer(rawOffer, intent, now);
      const price = atomic(offer.amountAtomic, "offer amount");
      if (spent + price > dailyCap) fail("offer exceeds remaining daily capital");
      const total = price + atomic(intent.economics.integrationCostAtomic, "integration cost") + atomic(intent.economics.verificationCostAtomic, "verification cost") + atomic(intent.economics.riskReserveAtomic, "risk reserve");
      if (total > atomic(intent.economics.maxTotalCostAtomic, "maximum total cost")) fail("offer exceeds the total cost cap");
      if (total > atomic(intent.economics.expectedValueAtomic, "expected value")) fail("offer has negative expected residual value");
      viable.push({ ...offer, totalCostAtomic: String(total), sourceIndex: index });
    } catch (error) {
      killed.push({ sourceIndex: index, reason: error.message });
    }
  }
  const preference = new Map(intent.policy.protocolPreference.map((item, index) => [item, index]));
  viable.sort((left, right) => {
    const amountOrder = atomic(left.amountAtomic, "amount") - atomic(right.amountAtomic, "amount");
    if (amountOrder) return amountOrder < 0n ? -1 : 1;
    const protocolOrder = preference.get(left.protocol) - preference.get(right.protocol);
    return protocolOrder || left.request.publicRoute.localeCompare(right.request.publicRoute);
  });
  const selected = viable[0] || null;
  const plan = {
    schemaVersion: SCHEMAS.plan,
    intentId: intent.intentId,
    purposeId: intent.purposeId,
    output: intent.output,
    decision: selected ? "authorized_candidate" : "no_viable_offer",
    selected,
    killed,
    generatedAt: new Date(now).toISOString(),
  };
  return Object.freeze({ ...plan, planId: digest(plan) });
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function parseBase64url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) fail("JWS segment is invalid");
  return Buffer.from(value, "base64url");
}

export function authorizePlan(plan, { privateKey, kid, now = Date.now(), ttlMs = 300_000 } = {}) {
  if (!record(plan) || plan.schemaVersion !== SCHEMAS.plan || plan.decision !== "authorized_candidate" || !plan.selected) fail("an executable plan is required");
  if (plan.planId !== digest(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "planId")))) fail("plan has been modified");
  if (!cleanString(kid, 200)) fail("authorization kid is required");
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 3_600_000) fail("authorization ttlMs is invalid");
  const authorization = {
    schemaVersion: SCHEMAS.authorization,
    authorizationId: digest({ planId: plan.planId, issuedAt: now, kid }),
    planId: plan.planId,
    intentId: plan.intentId,
    requestBindingDigest: plan.selected.request.bindingDigest,
    protocol: plan.selected.protocol,
    maxAmountAtomic: plan.selected.amountAtomic,
    recipient: plan.selected.recipient,
    network: plan.selected.network,
    asset: plan.selected.asset,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  const header = { alg: "EdDSA", kid, typ: "agent-payment-policy+jws" };
  const protectedSegment = base64url(canonicalJson(header));
  const payloadSegment = base64url(canonicalJson(authorization));
  const key = privateKey?.type === "private" ? privateKey : createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") fail("authorization key must be Ed25519");
  const signature = sign(null, Buffer.from(`${protectedSegment}.${payloadSegment}`), key).toString("base64url");
  return Object.freeze({ schemaVersion: SCHEMAS.authorizationJws, protected: protectedSegment, payload: payloadSegment, signature });
}

export function verifyAuthorization(envelope, { publicKey, plan, now = Date.now() } = {}) {
  if (!record(envelope) || envelope.schemaVersion !== SCHEMAS.authorizationJws) fail("authorization envelope is invalid");
  const header = JSON.parse(parseBase64url(envelope.protected));
  if (canonicalJson(header) !== parseBase64url(envelope.protected).toString("utf8") || header.alg !== "EdDSA" || header.typ !== "agent-payment-policy+jws" || !cleanString(header.kid, 200)) {
    fail("authorization header is invalid");
  }
  const payloadText = parseBase64url(envelope.payload).toString("utf8");
  const payload = JSON.parse(payloadText);
  if (canonicalJson(payload) !== payloadText || payload.schemaVersion !== SCHEMAS.authorization) fail("authorization payload is invalid");
  const key = publicKey?.type === "public" ? publicKey : createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") fail("authorization public key must be Ed25519");
  if (!verify(null, Buffer.from(`${envelope.protected}.${envelope.payload}`), key, parseBase64url(envelope.signature))) fail("authorization signature is invalid");
  if (Date.parse(payload.issuedAt) > now || Date.parse(payload.expiresAt) <= now) fail("authorization is not currently valid");
  if (plan) {
    if (payload.planId !== plan.planId || payload.intentId !== plan.intentId || payload.requestBindingDigest !== plan.selected?.request?.bindingDigest) fail("authorization does not match the plan");
    if (payload.maxAmountAtomic !== plan.selected.amountAtomic || payload.recipient !== plan.selected.recipient) fail("authorization economics do not match the plan");
  }
  Object.defineProperty(payload, VERIFIED_AUTHORIZATION, { value: true, enumerable: false });
  return Object.freeze(payload);
}

function executionBinding(method, network, action) {
  const normalizedMethod = cleanString(method, 128);
  const normalizedNetwork = cleanString(network, 200);
  if (!normalizedMethod || !/^[A-Za-z][A-Za-z0-9_.:-]{2,127}$/.test(normalizedMethod)) {
    fail("execution method is invalid");
  }
  if (!normalizedNetwork) fail("execution network is required");
  const serialized = canonicalRequestBody(action);
  return Object.freeze({
    method: normalizedMethod,
    network: normalizedNetwork,
    actionBinding: Object.freeze({
      mediaType: "application/json",
      bytes: Buffer.byteLength(serialized),
      digest: digest(canonicalJson({ method: normalizedMethod, network: normalizedNetwork, action })),
    }),
  });
}

export function authorizeExecution({ authorization, method, network, action } = {}, {
  privateKey,
  kid,
  now = Date.now(),
  ttlMs = 120_000,
} = {}) {
  if (!record(authorization) || authorization[VERIFIED_AUTHORIZATION] !== true) {
    fail("verified plan authorization is required");
  }
  if (!cleanString(kid, 200)) fail("execution authorization kid is required");
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 600_000) {
    fail("execution authorization ttlMs is invalid");
  }
  const binding = executionBinding(method, network, action);
  if (!cleanString(authorization.network, 200) || authorization.network.toLowerCase() !== binding.network.toLowerCase()) {
    fail("execution network does not match the authorized plan");
  }
  const payload = {
    schemaVersion: SCHEMAS.executionAuthorization,
    executionAuthorizationId: digest({
      authorizationId: authorization.authorizationId,
      actionBindingDigest: binding.actionBinding.digest,
      issuedAt: now,
      kid,
    }),
    authorizationId: authorization.authorizationId,
    planId: authorization.planId,
    intentId: authorization.intentId,
    method: binding.method,
    network: binding.network,
    actionBinding: binding.actionBinding,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  const header = { alg: "EdDSA", kid, typ: "agent-payment-policy-execution+jws" };
  const protectedSegment = base64url(canonicalJson(header));
  const payloadSegment = base64url(canonicalJson(payload));
  const key = privateKey?.type === "private" ? privateKey : createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") fail("execution authorization key must be Ed25519");
  const signature = sign(null, Buffer.from(`${protectedSegment}.${payloadSegment}`), key).toString("base64url");
  return Object.freeze({
    schemaVersion: SCHEMAS.executionAuthorizationJws,
    protected: protectedSegment,
    payload: payloadSegment,
    signature,
  });
}

export function verifyExecutionAuthorization(envelope, {
  publicKey,
  authorization,
  method,
  network,
  action,
  now = Date.now(),
} = {}) {
  if (!record(authorization) || authorization[VERIFIED_AUTHORIZATION] !== true) {
    fail("verified plan authorization is required");
  }
  if (!record(envelope) || envelope.schemaVersion !== SCHEMAS.executionAuthorizationJws) {
    fail("execution authorization envelope is invalid");
  }
  const headerText = parseBase64url(envelope.protected).toString("utf8");
  const header = JSON.parse(headerText);
  if (canonicalJson(header) !== headerText || header.alg !== "EdDSA" ||
      header.typ !== "agent-payment-policy-execution+jws" || !cleanString(header.kid, 200)) {
    fail("execution authorization header is invalid");
  }
  const payloadText = parseBase64url(envelope.payload).toString("utf8");
  const payload = JSON.parse(payloadText);
  if (canonicalJson(payload) !== payloadText || payload.schemaVersion !== SCHEMAS.executionAuthorization) {
    fail("execution authorization payload is invalid");
  }
  const key = publicKey?.type === "public" ? publicKey : createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") fail("execution authorization public key must be Ed25519");
  if (!verify(null, Buffer.from(`${envelope.protected}.${envelope.payload}`), key, parseBase64url(envelope.signature))) {
    fail("execution authorization signature is invalid");
  }
  if (Date.parse(payload.issuedAt) > now || Date.parse(payload.expiresAt) <= now) {
    fail("execution authorization is not currently valid");
  }
  if (payload.authorizationId !== authorization.authorizationId || payload.planId !== authorization.planId ||
      payload.intentId !== authorization.intentId) {
    fail("execution authorization does not match the verified plan authorization");
  }
  const expected = executionBinding(method, network, action);
  if (payload.method !== expected.method || payload.network.toLowerCase() !== expected.network.toLowerCase() ||
      canonicalJson(payload.actionBinding) !== canonicalJson(expected.actionBinding)) {
    fail("execution request does not match the exact authorized action");
  }
  const expectedId = digest({
    authorizationId: payload.authorizationId,
    actionBindingDigest: payload.actionBinding.digest,
    issuedAt: Date.parse(payload.issuedAt),
    kid: header.kid,
  });
  if (payload.executionAuthorizationId !== expectedId) {
    fail("execution authorization identifier is inconsistent");
  }
  Object.defineProperty(payload, VERIFIED_EXECUTION_AUTHORIZATION, { value: true, enumerable: false });
  return Object.freeze(payload);
}

function hasPath(value, path) {
  let current = value;
  for (const part of path.split(".")) {
    if ((!record(current) && !Array.isArray(current)) || !Object.prototype.hasOwnProperty.call(current, part)) return false;
    current = current[part];
  }
  return true;
}

export function validateOutput(value, contract) {
  const normalized = normalizeOutput(contract);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) fail("output is not JSON serializable");
  const bytes = Buffer.byteLength(serialized);
  if (bytes > normalized.maxResponseBytes) fail("output exceeds maxResponseBytes");
  const missingFields = normalized.requiredFields.filter((field) => !hasPath(value, field));
  if (missingFields.length) fail(`output is missing required fields: ${missingFields.join(", ")}`);
  return Object.freeze({ valid: true, bytes, responseDigest: digest(serialized) });
}

export function createReceipt({ plan, authorization, executionAuthorization, amountAtomic, transactionReference, response, now = Date.now() } = {}) {
  if (!record(plan) || plan.schemaVersion !== SCHEMAS.plan || !plan.selected) fail("receipt plan is required");
  if (plan.planId !== digest(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "planId")))) fail("receipt plan has been modified");
  if (!record(authorization) || authorization[VERIFIED_AUTHORIZATION] !== true || authorization.planId !== plan.planId || authorization.intentId !== plan.intentId) fail("verified authorization payload is required");
  const amount = atomic(amountAtomic, "receipt amountAtomic");
  if (amount > atomic(authorization.maxAmountAtomic, "authorized maximum")) fail("receipt amount exceeds authorization");
  const reference = cleanString(transactionReference, 500);
  if (!reference) fail("receipt transactionReference is required");
  const output = validateOutput(response, plan.output);
  let execution = null;
  if (executionAuthorization !== undefined) {
    if (!record(executionAuthorization) || executionAuthorization[VERIFIED_EXECUTION_AUTHORIZATION] !== true ||
        executionAuthorization.authorizationId !== authorization.authorizationId ||
        executionAuthorization.planId !== plan.planId || executionAuthorization.intentId !== plan.intentId) {
      fail("verified execution authorization does not match the receipt");
    }
    execution = {
      executionAuthorizationId: executionAuthorization.executionAuthorizationId,
      method: executionAuthorization.method,
      network: executionAuthorization.network,
      actionBinding: executionAuthorization.actionBinding,
    };
  }
  const receipt = {
    schemaVersion: SCHEMAS.receipt,
    receiptId: digest({ planId: plan.planId, authorizationId: authorization.authorizationId, transactionReference, responseDigest: output.responseDigest }),
    planId: plan.planId,
    intentId: plan.intentId,
    authorizationId: authorization.authorizationId,
    ...(execution ? { execution } : {}),
    protocol: plan.selected.protocol,
    request: {
      publicRoute: plan.selected.request.publicRoute,
      queryKeys: plan.selected.request.queryKeys,
      bodyBinding: plan.selected.request.bodyBinding,
      bindingDigest: plan.selected.request.bindingDigest,
    },
    settlement: {
      amountAtomic: String(amount),
      recipient: authorization.recipient,
      network: authorization.network,
      asset: authorization.asset,
      transactionReference: reference,
    },
    output,
    createdAt: new Date(now).toISOString(),
  };
  return Object.freeze(receipt);
}
