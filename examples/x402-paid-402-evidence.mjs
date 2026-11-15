import { pathToFileURL } from "node:url";
import { evaluateReceiptCompleteness, SCHEMAS } from "agent-payment-policy";

// Synthetic interoperability examples. This is not a header parser, payer,
// retry policy, or proof that a response belongs to an authorized attempt.
const fields = (value) => Object.fromEntries(
  ["amount", "network", "asset", "recipient", "payer"].map((name) => [name, value]),
);

export function observeExample({ dispatched, challenge, retryAfter, settlement, original, receiptFor, checkedTransaction }) {
  // Synthetic stand-ins for independently bound dispatch evidence. Never
  // populate receiptFor from the response, URL, payer, or a client identifier.
  const receiptScope = !dispatched || !settlement ? "not_supplied"
    : !original?.dispatchEvidence || !receiptFor ? "unverified_attempt"
      : original.dispatchEvidence === receiptFor ? "same_attempt" : "different_attempt";
  const receipt = {
    present: receiptScope === "same_attempt",
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
  // The only positive transaction facts below come from a separate checked
  // fixture for this exact dispatch, never from PAYMENT-RESPONSE.success.
  const transactionScoped = dispatched && Boolean(original?.dispatchEvidence && original.reference) &&
    checkedTransaction?.dispatchEvidence === original.dispatchEvidence &&
    checkedTransaction.reference === original.reference;
  return {
    // errorReason on PaymentRequired is the proposed extension, not a
    // requirement for older sellers. Absence means no diagnostic.
    challengeReason: challenge?.errorReason ?? null,
    reportedSettlementReason: receipt.present && settlement.success === false
      ? settlement.errorReason ?? null : null,
    receiptScope,
    lookupHint: (receiptScope === "unverified_attempt" ||
      (receipt.present && settlement.success === false && settlement.errorReason === "settlement_pending")) &&
      Boolean(settlement.transaction),
    retryAfter,
    decision: dispatched ? "inspect_original_attempt" : "inspect_current_offer",
    evidence: evaluateReceiptCompleteness({
      schemaVersion: SCHEMAS.receiptCompletenessObservation,
      protocol: "x402",
      receipt,
      transaction: transactionScoped
        ? { checked: true, success: "confirmed", transactionReference: "match", ...fields("match") }
        : { checked: false, success: "unknown", transactionReference: "not_checked", ...fields("not_checked") },
      balance: { checked: false, delta: "not_checked", asset: "not_checked", payer: "not_checked" },
      outputValidation: "not_checked",
    }),
  };
}

const original = { dispatchEvidence: "synthetic-signed-dispatch-a", reference: "0x" + "1".repeat(64), network: "eip155:8453",
  route: "https://seller.invalid/report", payer: "fixture-payer", paymentIdentifier: "same-client-supplied-identifier" };
const repeat = { ...original, dispatchEvidence: "synthetic-signed-dispatch-b", reference: "0x" + "2".repeat(64) };
const firstReport = { success: true, transaction: original.reference, network: original.network };
const secondReport = { ...firstReport, transaction: repeat.reference };
const checked = ({dispatchEvidence, reference}) => ({dispatchEvidence, reference});
export const cases = [
  { name: "first unsigned offer", dispatched: false, challenge: { errorReason: "missing_payment" }, retryAfter: null, settlement: null, original: null },
  { name: "sent, no receipt", dispatched: true, challenge: { errorReason: "resource_unavailable" }, retryAfter: "30", settlement: null, original },
  { name: "sent, provider refusal and current offer", dispatched: true, challenge: { errorReason: "resource_unavailable" }, retryAfter: "30", settlement: { success: false, errorReason: "insufficient_funds", transaction: "", network: original.network }, original, receiptFor: original.dispatchEvidence },
  { name: "sent, matching pending locator", dispatched: true, challenge: {}, retryAfter: null, settlement: { success: false, errorReason: "settlement_pending", transaction: original.reference, network: original.network }, original, receiptFor: original.dispatchEvidence },
  { name: "sent, conflicting locator for this dispatch", dispatched: true, challenge: {}, retryAfter: null, settlement: secondReport, original, receiptFor: original.dispatchEvidence },
  { name: "sent, unbound locator with reused client identifier", dispatched: true, challenge: { errorReason: "resource_unavailable" }, retryAfter: "10", settlement: {...firstReport, paymentIdentifier: repeat.paymentIdentifier}, original: repeat },
  { name: "repeat purchase, earlier receipt from another dispatch", dispatched: true, challenge: { errorReason: "resource_unavailable" }, retryAfter: "30", settlement: firstReport, original: repeat, receiptFor: original.dispatchEvidence, checkedTransaction: checked(original) },
  { name: "first paid result, checked for its dispatch", dispatched: true, challenge: null, retryAfter: null, settlement: firstReport, original, receiptFor: original.dispatchEvidence, checkedTransaction: checked(original) },
  { name: "repeat paid result, checked for its dispatch", dispatched: true, challenge: null, retryAfter: null, settlement: secondReport, original: repeat, receiptFor: repeat.dispatchEvidence, checkedTransaction: checked(repeat) },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(cases.map(({ name, ...input }) => ({ name, ...observeExample(input) })), null, 2));
}
