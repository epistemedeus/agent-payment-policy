import assert from "node:assert/strict";
import test from "node:test";
import { cases, observeExample, savedReceiptCases, summarizeSavedReceipts } from "./examples/x402-paid-402-evidence.mjs";

const expectations = [
  ["missing_payment", null, "inspect_current_offer", "insufficient", false, "not_supplied"],
  ["resource_unavailable", null, "inspect_original_attempt", "insufficient", false, "not_supplied"],
  ["resource_unavailable", "insufficient_funds", "inspect_original_attempt", "insufficient", false, "same_attempt"],
  [null, "settlement_pending", "inspect_original_attempt", "insufficient", true, "same_attempt"],
  [null, null, "inspect_original_attempt", "conflict", false, "same_attempt"],
  ["resource_unavailable", null, "inspect_original_attempt", "insufficient", false, "unverified_attempt"],
  ["resource_unavailable", null, "inspect_original_attempt", "insufficient", false, "different_attempt"],
  [null, null, "inspect_original_attempt", "reconciled", true, "same_attempt"],
  [null, null, "inspect_original_attempt", "reconciled", true, "same_attempt"],
];

cases.forEach((input, index) => test(`x402 402 example: ${input.name}`, () => {
  const { challengeReason, reportedSettlementReason, decision, receiptScope, evidence } = observeExample(input);
  assert.deepEqual([challengeReason, reportedSettlementReason, decision, evidence.state, evidence.transactionReferenceProven, receiptScope], expectations[index]);
  assert.equal(evidence.successProven, Boolean(input.checkedTransaction) && evidence.state === "reconciled");
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

test("repeat settlements share route, payer and client identifier but not the authorized dispatch", () => {
  const [first, second] = cases.slice(-2);
  for (const key of ["route", "payer", "paymentIdentifier"]) assert.equal(first.original[key], second.original[key]);
  assert.notEqual(first.original.reference, second.original.reference);
  assert.notEqual(first.original.dispatchEvidence, second.original.dispatchEvidence);
  const wrong = observeExample({ ...second, settlement: first.settlement,
    receiptFor: second.original.dispatchEvidence, checkedTransaction: first.checkedTransaction });
  assert.equal(wrong.evidence.state, "conflict");
  assert.equal(wrong.evidence.successProven, false);
  assert.deepEqual(wrong.evidence.conflicts, ["receipt.transaction_reference"]);
});

test("a provider locator or identifier echo cannot establish dispatch attribution", () => {
  const input = cases.find(item => item.name === "sent, unbound locator with reused client identifier");
  const result = observeExample({ ...input, settlement: { ...input.settlement,
    dispatchEvidence: input.original.dispatchEvidence, errorReason: "settlement_pending", success: false } });
  assert.equal(result.receiptScope, "unverified_attempt");
  assert.equal(result.lookupHint, true);
  assert.equal(result.reportedSettlementReason, null);
  assert.equal(result.evidence.receiptPresent, false);
  assert.deepEqual(result.evidence.conflicts, []);
});

const savedExpectations = [
  [1, 0, ["reconciled"], [1]],
  [2, 0, ["reconciled", "reconciled"], [1, 1]],
  [0, 2, ["unverified"], [0]],
  [0, 0, ["conflict"], [2]],
  [0, 0, ["conflict", "conflict"], [1, 1]],
];

for (const [index, { name, observations }] of savedReceiptCases.entries()) {
  test(`saved receipts: ${name}`, () => {
    const summary = summarizeSavedReceipts(observations);
    assert.equal(summary.receiptObservations, 2);
    assert.deepEqual([
      summary.reconciledSettlements, summary.unverifiedObservations,
      summary.authorizations.map(item => item.settlement),
      summary.authorizations.map(item => item.checkedEffects),
    ], savedExpectations[index]);
    assert.equal(summary.delivery, "unverified");
    assert.equal(summary.paymentAuthorized, false);
  });
}

test("a matching label in a receipt cannot replace checked authorization and effect identity", () => {
  const { authorization, checkedEffect } = savedReceiptCases[0].observations[0];
  const summary = summarizeSavedReceipts([
    { authorization: "", checkedEffect },
    { authorization, effect: checkedEffect.effect },
    { authorization, checkedEffect: { authorization, effect: " " } },
  ]);
  assert.equal(summary.reconciledSettlements, 0);
  assert.equal(summary.unverifiedObservations, 3);
  assert.deepEqual(summary.authorizations.map(item => item.settlement), ["unverified"]);
});
