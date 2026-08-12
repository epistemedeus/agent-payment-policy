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

function atomic(value, label) {
  const text = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(text)) fail(`${label} must be a non-negative atomic integer`);
  return BigInt(text);
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
