import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as policy from "./core.mjs";
import {
  createReceipt,
  evaluateReceiptCompleteness,
  inspectOutputSchema,
  prepareOutputValidator,
  SCHEMAS,
  verifyAuthorization,
} from "./core.mjs";
import {
  AUTHORITY_LABELS,
  BOUNDARY,
  DECISION_CHANGED_MAX,
  projectPortableEvidence,
  refusalPayload,
  sellerOfferReceiptId,
} from "./examples/portable-evidence/project.mjs";
import { buildPlan, loadFixture } from "./examples/verify-policy-receipt.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const CLI = fileURLToPath(new URL("./cli.mjs", import.meta.url));
const PROJECT = fileURLToPath(new URL("./examples/portable-evidence/project.mjs", import.meta.url));
const FIXTURES = new URL("./examples/portable-evidence/fixtures/", import.meta.url);
const LIVE_402 = JSON.parse(readFileSync(new URL("live-402-offer-receipt.json", FIXTURES), "utf8"));
const OMITTED = JSON.parse(readFileSync(new URL("missing-buyer-schema-digest.json", FIXTURES), "utf8"));
const CONST_TRUE = JSON.parse(readFileSync(new URL("const-true-schema.json", FIXTURES), "utf8"));
const PAID_BODY = Object.freeze({
  data: {
    value: 42,
    source: "https://seller.example/source",
  },
});

function run(command, args) {
  return spawnSync(process.execPath, [command, ...args], {
    encoding: "utf8",
    cwd: ROOT,
  });
}

function livePaymentRequired() {
  return {
    x402Version: LIVE_402.x402Version,
    accepts: LIVE_402.accepts,
    extensions: LIVE_402.extensions,
  };
}

function bindAdoptionReceipt() {
  const fixture = loadFixture();
  const { inspection, plan } = buildPlan(policy);
  const authorization = verifyAuthorization(fixture.envelope, {
    publicKey: fixture.publicKeyPem,
    plan,
    now: Date.parse("2026-08-20T16:00:01.000Z"),
  });
  const outputSchemaValidator = prepareOutputValidator({
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["data"],
      properties: {
        data: {
          type: "object",
          additionalProperties: false,
          required: ["value", "source"],
          properties: {
            value: { type: "number" },
            source: { type: "string", format: "uri" },
          },
        },
      },
    },
    contract: plan.output,
  });
  const receipt = createReceipt({
    plan,
    authorization,
    amountAtomic: plan.selected.amountAtomic,
    transactionReference: "0xadoptionfixture",
    response: PAID_BODY,
    outputSchemaValidator,
    now: Date.parse("2026-08-20T16:00:02.000Z"),
  });
  return { inspection, plan, receipt };
}

test("seller offer-receipt without buyer schemaDigest fails closed", () => {
  assert.equal(LIVE_402.httpStatus, 402);
  assert.equal(LIVE_402.extensions["offer-receipt"].info.offers[0].format, "eip712");
  assert.match(LIVE_402.extensions["offer-receipt"].info.offers[0].signature, /^0x[0-9a-f]+$/);

  assert.throws(
    () => projectPortableEvidence(OMITTED),
    (error) => {
      assert.equal(error.reason, "buyer_schema_digest_omitted");
      assert.match(error.message, /buyer schemaDigest is required when a seller offer-receipt is present/);
      assert.equal(error.extra.sellerOfferReceiptPresent, true);
      assert.equal(error.extra.decisionChanged, "buyer.schemaDigest:omitted");
      return true;
    },
  );

  const cli = run(PROJECT, ["examples/portable-evidence/fixtures/missing-buyer-schema-digest.json"]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.accepted, false);
  assert.deepEqual(body.reasons, ["buyer_schema_digest_omitted"]);
  assert.equal(body.evidence, null);
  assert.equal(body.sellerOfferReceiptPresent, true);
  assert.equal(body.buyerSchemaDigest, null);
  assert.equal(body.decisionChanged, "buyer.schemaDigest:omitted");
  assert.equal(body.boundary.ledgerCreated, false);
  assert.equal(body.boundary.paidCapture, false);
  assert.equal(body.boundary.paymentSent, false);
  assert.equal(body.boundary.walletAccessed, false);
  assert.doesNotMatch(cli.stdout, /BEGIN PRIVATE KEY|PAYMENT-SIGNATURE/);
});

test("output-accept rejects {ok:false} against a const-true schema without echoing the body", () => {
  const digest = inspectOutputSchema({ schema: CONST_TRUE }).schemaDigest;
  const accepted = run(CLI, [
    "output-accept",
    "examples/portable-evidence/fixtures/const-true-schema.json",
    digest,
    "examples/portable-evidence/fixtures/ok-true.json",
  ]);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).valid, true);

  const rejected = run(CLI, [
    "output-accept",
    "examples/portable-evidence/fixtures/const-true-schema.json",
    digest,
    "examples/portable-evidence/fixtures/ok-false.json",
  ]);
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.deepEqual(JSON.parse(rejected.stdout), { valid: false });
  assert.doesNotMatch(rejected.stdout, /"ok"|const-true/i);
});

test("receipt-completeness-check fail-on conflict preserves settlement while delivery is invalid", () => {
  const result = run(CLI, [
    "receipt-completeness-check",
    "examples/portable-evidence/fixtures/amount-mismatch-observation.json",
    "--fail-on",
    "conflict",
  ]);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.state, "conflict");
  assert.equal(report.deliveryState, "invalid");
  assert.equal(report.successProven, true);
  assert.equal(report.transactionReferenceProven, true);
  assert.deepEqual(report.conflicts, ["receipt.amount"]);
  assert.equal(report.paymentSent, false);
  assert.equal(report.walletAccessed, false);
  assert.match(report.evidenceBoundary, /does not parse raw receipts/);
});

test("projects seller offer-receipt id and buyer digest into an existing receipt", () => {
  const { inspection, receipt } = bindAdoptionReceipt();
  const completeness = evaluateReceiptCompleteness({
    schemaVersion: SCHEMAS.receiptCompletenessObservation,
    protocol: "x402",
    receipt: {
      present: true,
      success: "confirmed",
      transactionReference: "match",
      amount: "match",
      network: "match",
      asset: "match",
      recipient: "match",
      payer: "match",
    },
    transaction: {
      checked: false,
      success: "unknown",
      transactionReference: "not_checked",
      amount: "not_checked",
      network: "not_checked",
      asset: "not_checked",
      recipient: "not_checked",
      payer: "not_checked",
    },
    balance: { checked: false, delta: "not_checked", asset: "not_checked", payer: "not_checked" },
    outputValidation: "passed",
  });
  const projection = projectPortableEvidence({
    paymentRequired: livePaymentRequired(),
    buyer: { schemaDigest: inspection.schemaDigest, verdict: "accepted" },
    receipt,
    completeness,
  });
  assert.equal(projection.accepted, true);
  assert.equal(projection.evidence.schemaVersion, "agent-payment-policy.portable-evidence-projection.v1");
  assert.equal(projection.evidence.receiptId, receipt.receiptId);
  assert.equal(projection.evidence.buyer.schemaDigest, inspection.schemaDigest);
  assert.equal(projection.evidence.buyer.verdict, "accepted");
  assert.equal(projection.evidence.responseHash, receipt.output.responseDigest);
  assert.equal(projection.evidence.settlementRef, receipt.settlement.transactionReference);
  assert.equal(
    projection.evidence.sellerOfferReceiptId,
    sellerOfferReceiptId(LIVE_402.extensions["offer-receipt"].info.offers[0]),
  );
  assert.match(projection.evidence.sellerOfferReceiptId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(projection.evidence.decisionChanged, "unchanged");
  assert.ok(projection.evidence.decisionChanged.length <= DECISION_CHANGED_MAX);
  assert.deepEqual(projection.evidence.authority, AUTHORITY_LABELS);
  assert.equal(projection.boundary.ledgerCreated, false);
  assert.equal(projection.boundary.paidCapture, false);
  assert.equal(projection.boundary.sellerSignatureVerified, false);
  assert.deepEqual(projection.boundary, BOUNDARY);
  assert.doesNotMatch(JSON.stringify(projection.evidence), /0x12d6f439|resourceUrl|example\.com/);
  assert.doesNotMatch(JSON.stringify(projection.evidence), /BEGIN PRIVATE KEY/);
});

test("amount mismatch and rejected delivery become a bounded decision-changed string", () => {
  const { inspection, receipt } = bindAdoptionReceipt();
  const completeness = evaluateReceiptCompleteness(
    JSON.parse(readFileSync(new URL("amount-mismatch-observation.json", FIXTURES), "utf8")),
  );
  const projection = projectPortableEvidence({
    paymentRequired: livePaymentRequired(),
    buyer: { schemaDigest: inspection.schemaDigest, verdict: "rejected" },
    receipt,
    completeness,
  });
  assert.equal(projection.accepted, false);
  assert.equal(projection.evidence.decisionChanged, "buyer.verdict:rejected;completeness:conflict;delivery:invalid");
  assert.equal(completeness.successProven, true);
  assert.equal(completeness.deliveryState, "invalid");
  assert.equal(projection.evidence.settlementRef, "0xadoptionfixture");
  assert.equal(projection.evidence.receiptId, receipt.receiptId);
});

test("refusal payload never mints evidence or a ledger", () => {
  try {
    projectPortableEvidence(OMITTED);
    assert.fail("expected fail-closed omitted digest");
  } catch (error) {
    const payload = refusalPayload(error);
    assert.equal(payload.accepted, false);
    assert.equal(payload.evidence, null);
    assert.equal(payload.boundary.ledgerCreated, false);
    assert.equal(payload.boundary.paidCapture, false);
  }
});
