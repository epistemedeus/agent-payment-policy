#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { digest } from "../../core.mjs";

export const PROJECTION_SCHEMA = "agent-payment-policy.portable-evidence-projection.v1";
export const DECISION_CHANGED_MAX = 200;
export const OFFER_RECEIPT_FORMATS = Object.freeze(["eip712", "jws"]);
export const BUYER_VERDICTS = Object.freeze(["accepted", "rejected"]);
export const AUTHORITY_LABELS = Object.freeze({
  sellerOfferReceiptId: "seller-signed-offer-receipt",
  schemaDigest: "buyer-intent",
  verdict: "buyer-output-accept",
  responseHash: "buyer-output-accept",
  settlementRef: "caller-supplied-receipt",
  completeness: "receipt-completeness-classifier",
});
export const BOUNDARY = Object.freeze({
  credentialsUsed: false,
  networkAccessed: false,
  walletAccessed: false,
  paymentSigned: false,
  paymentSent: false,
  ledgerCreated: false,
  paidCapture: false,
  sellerSignatureVerified: false,
  statement: "Projects seller-signed x402 offer-receipt identity, buyer schemaDigest and output-accept verdict, response hash, and settlement ref into an existing public-safe receipt. It does not verify EIP-712/JWS seller signatures, create a ledger, recapture a paid body, load a wallet, or send a payment.",
});

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMPLETENESS_STATES = new Set(["reconciled", "partial", "conflict", "insufficient"]);
const DELIVERY_STATES = new Set(["valid", "invalid", "unverified"]);

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

function extractOfferReceiptExtension(input) {
  const paymentRequired = record(input?.paymentRequired) || input;
  const extensions = record(paymentRequired?.extensions) || record(input?.extensions);
  return record(extensions?.["offer-receipt"]) || record(paymentRequired?.["offer-receipt"]) || null;
}

export function extractSignedOffers(input) {
  const extension = extractOfferReceiptExtension(input);
  const offers = extension?.info?.offers;
  if (offers === undefined || offers === null) return [];
  if (!Array.isArray(offers)) {
    failClosed("seller_offer_receipt_malformed", "seller offer-receipt offers must be an array");
  }
  return offers;
}

export function sellerOfferReceiptId(offer) {
  const item = record(offer);
  if (!item) failClosed("seller_offer_receipt_malformed", "seller offer-receipt offer is required");
  const format = typeof item.format === "string" ? item.format.trim().toLowerCase() : "";
  const signature = typeof item.signature === "string" ? item.signature.trim() : "";
  if (!OFFER_RECEIPT_FORMATS.includes(format) || !signature) {
    failClosed("seller_offer_receipt_malformed", "seller offer-receipt must include format and signature");
  }
  return digest({
    format,
    acceptIndex: Number.isInteger(item.acceptIndex) ? item.acceptIndex : null,
    payload: item.payload ?? null,
    signature,
  });
}

function completenessSlice(value) {
  if (value === undefined || value === null) return null;
  const input = record(value);
  if (!input) failClosed("completeness_invalid", "completeness must be an object when provided");
  const state = typeof input.state === "string" ? input.state : null;
  const deliveryState = typeof input.deliveryState === "string" ? input.deliveryState : null;
  if (state && !COMPLETENESS_STATES.has(state)) failClosed("completeness_invalid", "completeness.state is invalid");
  if (deliveryState && !DELIVERY_STATES.has(deliveryState)) {
    failClosed("completeness_invalid", "completeness.deliveryState is invalid");
  }
  return Object.freeze({
    state,
    deliveryState,
    successProven: input.successProven === true,
    transactionReferenceProven: input.transactionReferenceProven === true,
    conflicts: Object.freeze(Array.isArray(input.conflicts) ? [...input.conflicts] : []),
  });
}

export function decisionChangedString({ schemaDigestOmitted = false, verdict = null, completeness = null } = {}) {
  const tokens = [];
  if (schemaDigestOmitted) tokens.push("buyer.schemaDigest:omitted");
  if (verdict === "rejected") tokens.push("buyer.verdict:rejected");
  if (completeness?.state && completeness.state !== "reconciled") {
    tokens.push(`completeness:${completeness.state}`);
  }
  if (completeness?.deliveryState && completeness.deliveryState !== "valid") {
    tokens.push(`delivery:${completeness.deliveryState}`);
  }
  const text = tokens.length ? tokens.join(";") : "unchanged";
  return text.length <= DECISION_CHANGED_MAX ? text : text.slice(0, DECISION_CHANGED_MAX);
}

function existingReceipt(value) {
  const receipt = record(value);
  if (!receipt) failClosed("existing_receipt_required", "projection requires an existing receipt");
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
    outputSchemaDigest: digestString(output.schemaDigest),
  });
}

export function projectPortableEvidence(input) {
  const body = record(input);
  if (!body) failClosed("projection_input_invalid", "portable evidence input must be a JSON object");
  const offers = extractSignedOffers(body);
  const sellerPresent = offers.length > 0;
  const buyer = record(body.buyer) || {};
  const buyerDigest = digestString(buyer.schemaDigest);
  const decisionChangedOmitted = decisionChangedString({ schemaDigestOmitted: true });
  if (sellerPresent && !buyerDigest) {
    failClosed(
      "buyer_schema_digest_omitted",
      "buyer schemaDigest is required when a seller offer-receipt is present",
      {
        sellerOfferReceiptPresent: true,
        buyerSchemaDigest: null,
        decisionChanged: decisionChangedOmitted,
      },
    );
  }
  if (!sellerPresent) {
    failClosed("seller_offer_receipt_missing", "seller-signed offer-receipt is required for portable evidence");
  }
  const sellerId = sellerOfferReceiptId(offers[0]);
  const verdict = typeof buyer.verdict === "string" ? buyer.verdict.trim().toLowerCase() : "";
  if (!BUYER_VERDICTS.includes(verdict)) {
    failClosed("buyer_verdict_required", "buyer output-accept verdict is required");
  }
  const receipt = existingReceipt(body.receipt);
  const completeness = completenessSlice(body.completeness);
  const decisionChanged = decisionChangedString({ verdict, completeness });
  const accepted = verdict === "accepted";
  return Object.freeze({
    accepted,
    reasons: Object.freeze(accepted ? [] : ["buyer_verdict_rejected"]),
    sellerOfferReceiptPresent: true,
    buyerSchemaDigest: buyerDigest,
    decisionChanged,
    evidence: Object.freeze({
      schemaVersion: PROJECTION_SCHEMA,
      receiptId: receipt.receiptId,
      sellerOfferReceiptId: sellerId,
      buyer: Object.freeze({ schemaDigest: buyerDigest, verdict }),
      responseHash: receipt.responseHash,
      settlementRef: receipt.settlementRef,
      authority: AUTHORITY_LABELS,
      decisionChanged,
    }),
    completeness,
    boundary: BOUNDARY,
  });
}

export function refusalPayload(error) {
  const extra = record(error?.extra) || {};
  const reason = typeof error?.reason === "string" ? error.reason : "projection_failed";
  const schemaDigestOmitted = reason === "buyer_schema_digest_omitted";
  return Object.freeze({
    accepted: false,
    reasons: Object.freeze([reason]),
    sellerOfferReceiptPresent: extra.sellerOfferReceiptPresent === true,
    buyerSchemaDigest: extra.buyerSchemaDigest === undefined ? null : extra.buyerSchemaDigest,
    decisionChanged: extra.decisionChanged || (schemaDigestOmitted
      ? decisionChangedString({ schemaDigestOmitted: true })
      : null),
    evidence: null,
    error: error?.message || "portable evidence projection failed",
    boundary: BOUNDARY,
  });
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export async function run(argv = process.argv.slice(2)) {
  const path = argv[0];
  if (!path || argv.length !== 1) {
    console.error("Usage: node examples/portable-evidence/project.mjs <projection-json>");
    process.exitCode = 2;
    return;
  }
  try {
    const result = projectPortableEvidence(JSON.parse(readFileSync(path, "utf8")));
    printJson(result);
    process.exitCode = result.accepted ? 0 : 1;
  } catch (error) {
    printJson(refusalPayload(error));
    process.exitCode = 1;
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await run();
