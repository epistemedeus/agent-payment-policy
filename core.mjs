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
  receipt: "agent-payment-policy.receipt.v1",
});

const CREDENTIAL_QUERY_KEY = /(?:^|[-_.])(api[-_.]?key|access[-_.]?token|auth|authorization|credential|password|secret|token)(?:$|[-_.])/i;
const PURPOSE_ID = /^[A-Za-z][A-Za-z0-9._:-]{2,127}$/;
const PROTOCOLS = new Set(["x402", "mpp"]);
const VERIFIED_AUTHORIZATION = Symbol("verified-agent-payment-policy-authorization");

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

export function normalizeRequest(method, target) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (!/^[A-Z]{3,12}$/.test(normalizedMethod)) fail("request method is invalid");
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
  const privateBinding = `${normalizedMethod} ${url.toString()}`;
  return Object.freeze({
    method: normalizedMethod,
    origin: url.origin,
    pathname: url.pathname,
    queryKeys,
    publicRoute: `${normalizedMethod} ${url.origin}${url.pathname}`,
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
  const request = normalizeRequest(offer.method, offer.url);
  if (intent.policy.ownedOrigins.includes(request.origin)) fail("owned supply is excluded");
  const recipient = cleanString(offer.recipient, 200);
  if (!recipient) fail("offer recipient is required");
  if (intent.policy.buyerAddress && recipient.toLowerCase() === intent.policy.buyerAddress.toLowerCase()) fail("self-payment is excluded");
  const amountAtomic = atomic(offer.amountAtomic, "offer amountAtomic");
  if (amountAtomic > atomic(intent.policy.maxAtomic, "policy maxAtomic")) fail("offer exceeds the per-call cap");
  const expiresAtMs = Date.parse(offer.expiresAt || "");
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) fail("offer is stale or has no expiry");
  return {
    protocol,
    request,
    amountAtomic: String(amountAtomic),
    network: cleanString(offer.network, 200),
    asset: cleanString(offer.asset, 200),
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

export function createReceipt({ plan, authorization, amountAtomic, transactionReference, response, now = Date.now() } = {}) {
  if (!record(plan) || plan.schemaVersion !== SCHEMAS.plan || !plan.selected) fail("receipt plan is required");
  if (plan.planId !== digest(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "planId")))) fail("receipt plan has been modified");
  if (!record(authorization) || authorization[VERIFIED_AUTHORIZATION] !== true || authorization.planId !== plan.planId || authorization.intentId !== plan.intentId) fail("verified authorization payload is required");
  const amount = atomic(amountAtomic, "receipt amountAtomic");
  if (amount > atomic(authorization.maxAmountAtomic, "authorized maximum")) fail("receipt amount exceeds authorization");
  const reference = cleanString(transactionReference, 500);
  if (!reference) fail("receipt transactionReference is required");
  const output = validateOutput(response, plan.output);
  const receipt = {
    schemaVersion: SCHEMAS.receipt,
    receiptId: digest({ planId: plan.planId, authorizationId: authorization.authorizationId, transactionReference, responseDigest: output.responseDigest }),
    planId: plan.planId,
    intentId: plan.intentId,
    authorizationId: authorization.authorizationId,
    protocol: plan.selected.protocol,
    request: {
      publicRoute: plan.selected.request.publicRoute,
      queryKeys: plan.selected.request.queryKeys,
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
