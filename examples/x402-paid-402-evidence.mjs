import { evaluateReceiptCompleteness, SCHEMAS } from "../core.mjs";

// Synthetic interoperability examples. This is not a header parser, payer,
// retry policy, or proof that a response belongs to an authorized attempt.
const fields = (value) => Object.fromEntries(
  ["amount", "network", "asset", "recipient", "payer"].map((name) => [name, value]),
);

export function observeExample({ dispatched, challenge, retryAfter, settlement, original }) {
  const receipt = {
    present: dispatched && settlement !== null,
    success: "unknown",
    transactionReference: "missing",
    ...fields("not_checked"),
  };
  if (receipt.present) {
    // Only an independently retained original reference or network can
    // supply the comparison. A new quote for the same URL cannot supply it.
    if (settlement.transaction) {
      receipt.transactionReference = !original?.reference ? "not_checked"
        : settlement.transaction === original.reference ? "match" : "mismatch";
    }
    if (settlement.network && original?.network) {
      receipt.network = settlement.network === original.network ? "match" : "mismatch";
    }
  }
  return {
    // errorReason on PaymentRequired is the proposed extension, not a
    // requirement for older sellers. Absence means no diagnostic.
    challengeReason: challenge.errorReason ?? null,
    reportedSettlementReason: receipt.present && settlement.success === false
      ? settlement.errorReason ?? null : null,
    retryAfter,
    decision: dispatched ? "inspect_original_attempt" : "inspect_current_offer",
    evidence: evaluateReceiptCompleteness({
      schemaVersion: SCHEMAS.receiptCompletenessObservation,
      protocol: "x402",
      receipt,
      transaction: { checked: false, success: "unknown", transactionReference: "not_checked", ...fields("not_checked") },
      balance: { checked: false, delta: "not_checked", asset: "not_checked", payer: "not_checked" },
      outputValidation: "not_checked",
    }),
  };
}

const original = { reference: "0x" + "1".repeat(64), network: "eip155:8453" };
export const cases = [
  { name: "first unsigned offer", dispatched: false, challenge: { errorReason: "missing_payment" }, retryAfter: null, settlement: null, original: null },
  { name: "sent, no receipt", dispatched: true, challenge: { errorReason: "resource_unavailable" }, retryAfter: "30", settlement: null, original },
  { name: "sent, provider refusal and current offer", dispatched: true, challenge: { errorReason: "resource_unavailable" }, retryAfter: "30", settlement: { success: false, errorReason: "insufficient_funds", transaction: "", network: original.network }, original },
  { name: "sent, matching pending locator", dispatched: true, challenge: {}, retryAfter: null, settlement: { success: false, errorReason: "settlement_pending", transaction: original.reference, network: original.network }, original },
  { name: "sent, different earlier locator", dispatched: true, challenge: {}, retryAfter: null, settlement: { success: true, transaction: "0x" + "2".repeat(64), network: original.network }, original },
];
