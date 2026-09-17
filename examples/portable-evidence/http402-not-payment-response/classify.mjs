#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const OBSERVATION_SCHEMA = "agent-payment-policy.http402-not-payment-response-observation.v1";
export const REPORT_SCHEMA = "agent-payment-policy.http402-not-payment-response.v1";
export const WELL_KNOWN_RECEIPT_X402 =
  "PAYMENT-RESPONSE with signed offer-receipt extension and settlement reference";
export const EXISTING_RECEIPT_SOURCES = Object.freeze([
  "existing_receipt",
  "caller-supplied-receipt",
  "caller_supplied_receipt",
]);
export const FORBIDDEN_SETTLEMENT_REF_SOURCES = Object.freeze([
  "http402",
  "http_402",
  "http-402",
  "payment_required",
  "payment-required",
  "PAYMENT-REQUIRED",
  "payment_response",
  "payment-response",
  "PAYMENT-RESPONSE",
  "well_known",
  "well-known",
  "offer_receipt",
  "offer-receipt",
  "body",
  "error",
  "unpaid",
]);
export const INVENTED_RECEIPT_FIELDS = Object.freeze([
  "loyaltyPoints",
  "buyerEmail",
  "npsScore",
  "tipAmount",
  "throughBlock",
  "uniqueVisitors",
]);
export const BOUNDARY = Object.freeze({
  credentialsUsed: false,
  networkAccessed: false,
  walletAccessed: false,
  paymentSigned: false,
  paymentSent: false,
  paidCapture: false,
  sellerSignatureVerified: false,
  ledgerCreated: false,
  paymentResponseTreatedAsPresent: false,
  statement: "Classifies a caller-supplied unpaid HTTP 402 PAYMENT-REQUIRED against a well-known PAYMENT-RESPONSE declaration. settlementRef is taken only from an existing createReceipt. The 402 body is not PAYMENT-RESPONSE, not settlement.transactionReference, and not demand. This helper does not fetch, pay, verify seller signatures, or recapture a paid body.",
});

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const OBSERVATION_KEYS = new Set([
  "schemaVersion",
  "note",
  "capturedAt",
  "http",
  "paymentRequired",
  "wellKnown",
  "receipt",
  "settlementRefSource",
  "treatAbsenceAsDemand",
  "treatUnpaidAsPaymentResponse",
  "absenceMeansPaid",
  "demand",
  "receiptFields",
]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function failClosed(reason, message, extra = {}) {
  const error = new Error(message);
  error.reason = reason;
  error.extra = extra;
  throw error;
}

function digestString(value) {
  return typeof value === "string" && DIGEST.test(value.toLowerCase()) ? value.toLowerCase() : null;
}

function headerNames(http) {
  const names = new Set();
  if (Array.isArray(http.headerNames)) {
    for (const name of http.headerNames) {
      if (typeof name !== "string") failClosed("http_headers_invalid", "http.headerNames must be strings");
      const normalized = name.trim().toLowerCase();
      if (normalized) names.add(normalized);
    }
  }
  const headers = record(http.headers);
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      const normalized = String(key).trim().toLowerCase();
      if (!normalized) continue;
      if (value === false || value === null || value === "absent" || value === "") continue;
      names.add(normalized);
    }
  }
  return names;
}

function headerPresent(names, header) {
  return names.has(String(header).toLowerCase());
}

function walkKeys(value, visit, path = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkKeys(item, visit, `${path}[${index}]`));
    return;
  }
  const obj = record(value);
  if (!obj) return;
  for (const [key, child] of Object.entries(obj)) {
    visit(key, child, path ? `${path}.${key}` : key);
    walkKeys(child, visit, path ? `${path}.${key}` : key);
  }
}

function assertNoSettlementRefInUnpaid(paymentRequired) {
  walkKeys(paymentRequired, (key, child, path) => {
    if (key === "transactionReference" || key === "settlementRef") {
      failClosed(
        "unpaid_402_carries_settlement_reference",
        `unpaid HTTP 402 must not carry ${path}`,
      );
    }
    if (key === "PAYMENT-RESPONSE" || key === "payment-response") {
      failClosed(
        "unpaid_402_carries_payment_response",
        `unpaid HTTP 402 must not carry ${path}`,
      );
    }
  });
}

function inventedFieldHits(input) {
  const hits = new Set();
  const named = Array.isArray(input.receiptFields) ? input.receiptFields : [];
  for (const field of named) {
    if (INVENTED_RECEIPT_FIELDS.includes(field)) hits.add(field);
  }
  walkKeys(input, (key) => {
    if (INVENTED_RECEIPT_FIELDS.includes(key)) hits.add(key);
  });
  return [...hits];
}

function looksLikePaymentRequired(value) {
  const body = record(value);
  if (!body) return false;
  if (typeof body.error === "string" && body.error.trim().toLowerCase() === "payment required") return true;
  if (body.x402Version !== undefined && !digestString(body.receiptId) && (body.accepts !== undefined || body.extensions !== undefined)) {
    return true;
  }
  return false;
}

function normalizeSettlementRefSource(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") failClosed("settlement_ref_source_invalid", "settlementRefSource must be a string");
  return value.trim();
}

function isExistingReceiptSource(source) {
  if (!source) return false;
  const normalized = source.toLowerCase().replace(/-/g, "_");
  return EXISTING_RECEIPT_SOURCES.some((item) => item.toLowerCase().replace(/-/g, "_") === normalized);
}

function isForbiddenSettlementRefSource(source) {
  if (!source) return false;
  const normalized = source.toLowerCase().replace(/-/g, "_");
  return FORBIDDEN_SETTLEMENT_REF_SOURCES.some((item) => item.toLowerCase().replace(/-/g, "_") === normalized);
}

function existingReceipt(value) {
  const receipt = record(value);
  if (!receipt) failClosed("existing_receipt_required", "projection requires an existing receipt");
  if (looksLikePaymentRequired(receipt)) {
    failClosed(
      "payment_response_missing",
      "unpaid HTTP 402 PAYMENT-REQUIRED is not a PAYMENT-RESPONSE settlementRef source",
    );
  }
  const receiptId = digestString(receipt.receiptId);
  if (!receiptId) failClosed("existing_receipt_required", "existing receiptId is required");
  const settlement = record(receipt.settlement);
  const settlementRef = typeof settlement?.transactionReference === "string"
    ? settlement.transactionReference.trim()
    : "";
  if (!settlementRef || settlementRef.length > 500) {
    failClosed("existing_receipt_required", "existing receipt settlement ref is required");
  }
  const output = record(receipt.output) || {};
  const responseHash = digestString(output.responseDigest);
  if (!responseHash) failClosed("existing_receipt_required", "existing receipt response hash is required");
  return Object.freeze({
    receiptId,
    settlementRef,
    responseHash,
  });
}

function classifyHttp(input) {
  const http = record(input.http);
  if (!http) failClosed("http_required", "http observation is required");
  const status = Number(http.status);
  if (status !== 402) failClosed("not_unpaid_http_402", "observation must be unpaid HTTP 402");
  const names = headerNames(http);
  const paymentRequiredPresent = headerPresent(names, "payment-required");
  const paymentResponsePresent = headerPresent(names, "payment-response");
  const paymentSignaturePresent = headerPresent(names, "payment-signature");
  if (!paymentRequiredPresent) {
    failClosed("payment_required_missing", "unpaid HTTP 402 must present PAYMENT-REQUIRED");
  }
  if (paymentResponsePresent) {
    failClosed(
      "unpaid_402_carries_payment_response",
      "unpaid HTTP 402 must not present PAYMENT-RESPONSE",
    );
  }
  if (paymentSignaturePresent) {
    failClosed("payment_signature_out_of_scope", "this classifier does not accept PAYMENT-SIGNATURE");
  }
  return Object.freeze({
    status: 402,
    paymentRequiredHeader: "present",
    paymentResponseHeader: "absent",
    paymentSignatureHeader: "absent",
  });
}

function classifyPaymentRequired(input) {
  const body = record(input.paymentRequired);
  if (!body) failClosed("payment_required_body_missing", "paymentRequired body is required");
  const error = typeof body.error === "string" ? body.error.trim() : "";
  if (error.toLowerCase() !== "payment required") {
    failClosed("payment_required_error_missing", "paymentRequired.error must be Payment required");
  }
  const version = body.x402Version;
  if (version !== 2 && version !== "2") {
    failClosed("payment_required_version_invalid", "paymentRequired.x402Version must be 2");
  }
  assertNoSettlementRefInUnpaid(body);
  return Object.freeze({
    x402Version: 2,
    error: "Payment required",
    class: "PAYMENT-REQUIRED",
  });
}

function classifyWellKnown(input) {
  const wellKnown = record(input.wellKnown);
  if (!wellKnown) failClosed("well_known_required", "wellKnown operation receipt declaration is required");
  const operation = record(wellKnown.operation) || wellKnown;
  const receipt = record(operation.receipt);
  const declared = typeof receipt?.x402 === "string" ? receipt.x402.trim() : "";
  if (!declared.includes("PAYMENT-RESPONSE")) {
    failClosed("well_known_receipt_x402_missing", "well-known operations[].receipt.x402 must declare PAYMENT-RESPONSE");
  }
  return Object.freeze({
    method: typeof operation.method === "string" ? operation.method : null,
    path: typeof operation.path === "string" ? operation.path : null,
    receiptX402: declared,
    declarationSatisfiedByThisResponse: false,
  });
}

export function classifyHttp402NotPaymentResponse(input) {
  const body = record(input);
  if (!body) failClosed("observation_invalid", "http402-not-payment-response observation must be a JSON object");
  const extras = Object.keys(body).filter((key) => !OBSERVATION_KEYS.has(key));
  if (extras.length) failClosed("observation_invalid", `unsupported fields: ${extras.join(", ")}`);
  if (body.schemaVersion !== undefined && body.schemaVersion !== OBSERVATION_SCHEMA) {
    failClosed("unsupported_schema", `unsupported observation schema: ${body.schemaVersion}`);
  }

  const invented = inventedFieldHits(body);
  if (invented.length) {
    failClosed(
      "invented_receipt_field",
      `invented receipt field without live schema: ${invented.join(", ")}`,
      { invented },
    );
  }

  const http = classifyHttp(body);
  const unpaid = classifyPaymentRequired(body);
  const wellKnown = classifyWellKnown(body);
  const classified = { unpaid402Class: unpaid.class };

  if (body.treatAbsenceAsDemand === true || body.absenceMeansPaid === true || body.demand === true) {
    failClosed(
      "absence_is_not_demand",
      "absence of PAYMENT-RESPONSE on unpaid HTTP 402 is not demand",
      classified,
    );
  }
  if (body.treatUnpaidAsPaymentResponse === true) {
    failClosed(
      "payment_response_missing",
      "unpaid HTTP 402 PAYMENT-REQUIRED is not well-known PAYMENT-RESPONSE",
      classified,
    );
  }

  const source = normalizeSettlementRefSource(body.settlementRefSource);
  if (isForbiddenSettlementRefSource(source) || (source && !isExistingReceiptSource(source))) {
    failClosed(
      "payment_response_missing",
      "unpaid HTTP 402 PAYMENT-REQUIRED is not a PAYMENT-RESPONSE settlementRef source",
      { ...classified, settlementRefSource: source },
    );
  }

  const receipt = existingReceipt(body.receipt);
  return Object.freeze({
    accepted: true,
    reasons: Object.freeze([]),
    unpaid402Class: unpaid.class,
    paymentResponse: "missing",
    unpaid: Object.freeze({
      httpStatus: http.status,
      error: unpaid.error,
      paymentRequiredHeader: http.paymentRequiredHeader,
      paymentResponseHeader: http.paymentResponseHeader,
      class: unpaid.class,
    }),
    wellKnown: Object.freeze({
      method: wellKnown.method,
      path: wellKnown.path,
      receiptX402: wellKnown.receiptX402,
      livePaymentResponse: false,
      declarationSatisfiedByThisResponse: false,
    }),
    evidence: Object.freeze({
      schemaVersion: REPORT_SCHEMA,
      receiptId: receipt.receiptId,
      settlementRef: receipt.settlementRef,
      settlementRefSource: "caller-supplied-receipt",
      responseHash: receipt.responseHash,
      unpaid402Class: unpaid.class,
      paymentResponse: "missing",
      wellKnownReceiptX402: wellKnown.receiptX402,
      wellKnownSatisfiedByThisResponse: false,
    }),
    boundary: BOUNDARY,
  });
}

export function refusalPayload(error) {
  const extra = record(error?.extra) || {};
  const reason = typeof error?.reason === "string" ? error.reason : "classification_failed";
  return Object.freeze({
    accepted: false,
    reasons: Object.freeze([reason]),
    unpaid402Class: extra.unpaid402Class ?? null,
    paymentResponse: "missing",
    evidence: null,
    error: error?.message || "http402-not-payment-response classification failed",
    boundary: BOUNDARY,
  });
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export async function run(argv = process.argv.slice(2)) {
  const path = argv[0];
  if (!path || argv.length !== 1) {
    console.error("Usage: node examples/portable-evidence/http402-not-payment-response/classify.mjs <observation-json>");
    process.exitCode = 2;
    return;
  }
  try {
    const result = classifyHttp402NotPaymentResponse(JSON.parse(readFileSync(path, "utf8")));
    printJson(result);
    process.exitCode = result.accepted ? 0 : 1;
  } catch (error) {
    printJson(refusalPayload(error));
    process.exitCode = 1;
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await run();
