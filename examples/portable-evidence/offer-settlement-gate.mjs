#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EQUALITY_SCHEMA = "agent-payment-policy.offer-settlement-equality.v1";
export const SETTLEMENT_BINDINGS = Object.freeze([
  Object.freeze({ payload: "amount", settlement: "amountAtomic" }),
  Object.freeze({ payload: "network", settlement: "network" }),
  Object.freeze({ payload: "asset", settlement: "asset" }),
  Object.freeze({ payload: "payTo", settlement: "recipient" }),
]);
export const INVENTED_RECEIPT_FIELDS = Object.freeze([
  "loyaltyPoints",
  "throughBlock",
  "buyerEmail",
  "npsScore",
  "tipAmount",
]);
export const BOUNDARY = Object.freeze({
  credentialsUsed: false,
  networkAccessed: false,
  walletAccessed: false,
  paymentSigned: false,
  paymentSent: false,
  ledgerCreated: false,
  paidCapture: false,
  sellerSignatureVerified: false,
  unitConverted: false,
  statement: "Fail-closed string equality of live x402 offer-receipt payload amount/network/asset/payTo against existing createReceipt.settlement amountAtomic/network/asset/recipient. It does not verify EIP-712/JWS, hash the signed offer blob, create a ledger, recapture a paid body, load a wallet, send a payment, or treat a missing payload amount as demand.",
});

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function failClosed(reason, message, extra = {}) {
  const error = new Error(message);
  error.reason = reason;
  error.extra = extra;
  throw error;
}

function exactString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
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

export function extractOfferPayload(input) {
  const offers = extractSignedOffers(input);
  if (offers.length === 0) {
    failClosed("seller_offer_receipt_missing", "seller-signed offer-receipt is required for offer-settlement equality");
  }
  if (offers.length !== 1) {
    failClosed(
      "seller_offer_receipt_ambiguous",
      "seller offer-receipt must contain exactly one signed offer",
    );
  }
  const payload = record(offers[0]?.payload);
  if (!payload) failClosed("offer_payload_missing", "signed offer payload is required");
  return payload;
}

export function settlementFrom(input) {
  const body = record(input);
  if (!body) failClosed("existing_receipt_required", "offer-settlement equality requires an existing receipt");
  const receipt = record(body.receipt) || body;
  const settlement = record(receipt.settlement) || record(body.settlement);
  if (!settlement) failClosed("existing_receipt_required", "existing createReceipt.settlement is required");
  return settlement;
}

function rejectInventedBindFields(input) {
  const body = record(input) || {};
  const requested = [];
  if (Array.isArray(body.bindFields)) requested.push(...body.bindFields);
  if (Array.isArray(body.compareFields)) requested.push(...body.compareFields);
  const invented = requested.filter((name) => INVENTED_RECEIPT_FIELDS.includes(name));
  if (invented.length) {
    failClosed(
      "invented_receipt_field",
      `refusing to bind invented receipt fields: ${invented.join(",")}`,
      { invented },
    );
  }
}

export function compareOfferSettlement(payload, settlement) {
  const mismatches = [];
  const compared = [];
  for (const binding of SETTLEMENT_BINDINGS) {
    const payloadValue = exactString(payload?.[binding.payload]);
    const settlementValue = exactString(settlement?.[binding.settlement]);
    const equal = payloadValue !== null && settlementValue !== null && payloadValue === settlementValue;
    compared.push(Object.freeze({
      payloadField: binding.payload,
      settlementField: binding.settlement,
      payload: payloadValue,
      settlement: settlementValue,
      equal,
    }));
    if (!equal) {
      mismatches.push(Object.freeze({
        field: binding.payload,
        settlementField: binding.settlement,
        payload: payloadValue,
        settlement: settlementValue,
        absenceIsNotMatch: payloadValue === null || settlementValue === null,
      }));
    }
  }
  return Object.freeze({
    equal: mismatches.length === 0,
    compared: Object.freeze(compared),
    mismatches: Object.freeze(mismatches),
  });
}

function publicCompared(compared) {
  return Object.freeze(Object.fromEntries(compared.map((row) => [
    row.payloadField,
    Object.freeze({
      payload: row.payload,
      settlement: row.settlement,
      equal: row.equal,
    }),
  ])));
}

export function projectOfferSettlement(input, { settlement: boundSettlement = null } = {}) {
  const body = record(input);
  if (!body) failClosed("projection_input_invalid", "offer-settlement input must be a JSON object");
  rejectInventedBindFields(body);
  const payload = extractOfferPayload(body);
  const settlement = boundSettlement || settlementFrom(body);
  const result = compareOfferSettlement(payload, settlement);
  if (!result.equal) {
    failClosed(
      "offer_settlement_mismatch",
      "live offer payload settlement fields do not equal createReceipt.settlement",
      {
        mismatches: result.mismatches,
        compared: result.compared,
        settlementSource: boundSettlement ? "createReceipt" : "caller-supplied-receipt",
      },
    );
  }
  const settlementRef = exactString(settlement.transactionReference);
  return Object.freeze({
    accepted: true,
    reasons: Object.freeze([]),
    evidence: Object.freeze({
      schemaVersion: EQUALITY_SCHEMA,
      compared: publicCompared(result.compared),
      settlementRef,
      settlementSource: boundSettlement ? "createReceipt" : "caller-supplied-receipt",
    }),
    mismatches: Object.freeze([]),
    createReceiptBound: Boolean(boundSettlement),
    boundary: BOUNDARY,
  });
}

export function refusalPayload(error) {
  const extra = record(error?.extra) || {};
  const reason = typeof error?.reason === "string" ? error.reason : "projection_failed";
  return Object.freeze({
    accepted: false,
    reasons: Object.freeze([reason]),
    evidence: null,
    mismatches: Object.freeze(Array.isArray(extra.mismatches) ? extra.mismatches : []),
    invented: Object.freeze(Array.isArray(extra.invented) ? extra.invented : []),
    createReceiptBound: extra.settlementSource === "createReceipt",
    error: error?.message || "offer-settlement equality failed",
    boundary: BOUNDARY,
  });
}

export async function bindCreateReceiptSettlement() {
  const { run } = await import(new URL("../verify-policy-receipt.mjs", import.meta.url));
  const result = await run();
  const settlement = record(result?.receipt?.settlement);
  if (!settlement) failClosed("existing_receipt_required", "createReceipt did not return settlement");
  return Object.freeze({ ...settlement });
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export async function run(argv = process.argv.slice(2)) {
  const args = [...argv];
  let bindCreateReceipt = false;
  const positional = [];
  for (const arg of args) {
    if (arg === "--create-receipt") bindCreateReceipt = true;
    else if (arg.startsWith("-")) {
      console.error("Usage: node examples/portable-evidence/offer-settlement-gate.mjs [--create-receipt] <offer-settlement-json>");
      process.exitCode = 2;
      return;
    } else positional.push(arg);
  }
  if (positional.length !== 1) {
    console.error("Usage: node examples/portable-evidence/offer-settlement-gate.mjs [--create-receipt] <offer-settlement-json>");
    process.exitCode = 2;
    return;
  }
  try {
    const input = JSON.parse(readFileSync(positional[0], "utf8"));
    const settlement = bindCreateReceipt ? await bindCreateReceiptSettlement() : null;
    const result = projectOfferSettlement(input, { settlement });
    printJson(result);
    process.exitCode = 0;
  } catch (error) {
    printJson(refusalPayload(error));
    process.exitCode = 1;
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await run();
