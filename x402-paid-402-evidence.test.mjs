import assert from "node:assert/strict";
import test from "node:test";
import { cases, observeExample } from "./examples/x402-paid-402-evidence.mjs";

const expectations = [
  ["missing_payment", null, "inspect_current_offer", "insufficient", false],
  ["resource_unavailable", null, "inspect_original_attempt", "insufficient", false],
  ["resource_unavailable", "insufficient_funds", "inspect_original_attempt", "insufficient", false],
  [null, "settlement_pending", "inspect_original_attempt", "insufficient", true],
  [null, null, "inspect_original_attempt", "conflict", false],
];

cases.forEach((input, index) => test(`x402 402 example: ${input.name}`, () => {
  const { challengeReason, reportedSettlementReason, decision, evidence } = observeExample(input);
  assert.deepEqual([challengeReason, reportedSettlementReason, decision, evidence.state, evidence.transactionReferenceProven], expectations[index]);
  assert.equal(evidence.successProven, false);
  assert.equal(evidence.deliveryState, "unverified");
  assert.equal(evidence.paymentSigned, false);
  assert.equal(evidence.paymentSent, false);
}));

test("x402 402 challenge text and wait hints do not change evidence about the sent attempt", () => {
  const input = cases[2];
  const earlier = observeExample(input);
  const later = observeExample({ ...input, challenge: {}, retryAfter: "Sun, 15 Nov 2026 12:00:00 GMT" });
  assert.deepEqual(earlier.evidence, later.evidence);
  assert.equal(later.decision, earlier.decision);
  const unmatched = observeExample({ ...cases[3], original: null });
  assert.equal(unmatched.evidence.state, "insufficient");
  assert.equal(unmatched.evidence.transactionReferenceProven, false);
});
