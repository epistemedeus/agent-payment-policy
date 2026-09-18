import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  BOUNDARY,
  MAX_OBSERVATION_BYTES,
  REPORT_SCHEMA,
  WELL_KNOWN_RECEIPT_X402,
  classifyHttp402NotPaymentResponse,
  refusalPayload,
} from "./classify.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLASSIFY = join(HERE, "classify.mjs");
const FIXTURES = join(HERE, "fixtures");
const PASS = join(FIXTURES, "pass-402-plus-separate-receipt.json");
const SEEDED_402 = join(FIXTURES, "seeded-402-as-settlement-ref.json");
const SEEDED_ABSENCE = join(FIXTURES, "seeded-treat-absence-as-demand.json");
const SEEDED_INVENTED = join(FIXTURES, "seeded-invented-field.json");
const SEEDED_WELL_KNOWN = join(FIXTURES, "seeded-well-known-as-settlement-ref.json");
const SEEDED_STRING_TRUE = join(FIXTURES, "seeded-string-true-absence-as-demand.json");
const SEEDED_WK_NEGATION = join(FIXTURES, "seeded-well-known-negation.json");
const SEEDED_402_DIGEST = join(FIXTURES, "seeded-402-receipt-with-digest.json");
const SEEDED_PR_HEADER = join(FIXTURES, "seeded-payment-response-header.json");

function run(file) {
  return spawnSync(process.execPath, [CLASSIFY, file], {
    encoding: "utf8",
    cwd: join(HERE, "../../.."),
  });
}

function load(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

test("402 plus a separate existing receipt still projects settlementRef", () => {
  const observation = load(PASS);
  assert.equal(observation.http.status, 402);
  assert.ok(observation.http.headerNames.includes("payment-required"));
  assert.equal(observation.http.headerNames.includes("payment-response"), false);
  assert.equal(observation.paymentRequired.error, "Payment required");
  assert.equal(observation.wellKnown.operation.receipt.x402, WELL_KNOWN_RECEIPT_X402);

  const result = classifyHttp402NotPaymentResponse(observation);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.unpaid402Class, "PAYMENT-REQUIRED");
  assert.equal(result.paymentResponse, "missing");
  assert.equal(result.unpaid.httpStatus, 402);
  assert.equal(result.unpaid.paymentRequiredHeader, "present");
  assert.equal(result.unpaid.paymentResponseHeader, "absent");
  assert.equal(result.wellKnown.declarationSatisfiedByThisResponse, false);
  assert.equal(result.wellKnown.livePaymentResponse, false);
  assert.equal(result.evidence.schemaVersion, REPORT_SCHEMA);
  assert.equal(result.evidence.receiptId, observation.receipt.receiptId);
  assert.equal(result.evidence.settlementRef, "0xadoptionfixture");
  assert.equal(result.evidence.settlementRefSource, "caller-supplied-receipt");
  assert.equal(result.evidence.paymentResponse, "missing");
  assert.equal(result.evidence.wellKnownSatisfiedByThisResponse, false);
  assert.equal(result.evidence.wellKnownReceiptX402, WELL_KNOWN_RECEIPT_X402);
  assert.deepEqual(result.boundary, BOUNDARY);
  assert.equal(result.boundary.paymentSent, false);
  assert.equal(result.boundary.paymentResponseTreatedAsPresent, false);

  const printed = JSON.stringify(result);
  assert.doesNotMatch(printed, /0xe7aeee|resourceUrl|PAYMENT-SIGNATURE|BEGIN PRIVATE KEY|loyaltyPoints/);
});

test("CLI pass exits 0 and does not echo the 402 signature", () => {
  const cli = run(PASS);
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.accepted, true);
  assert.equal(body.evidence.settlementRef, "0xadoptionfixture");
  assert.equal(body.evidence.settlementRefSource, "caller-supplied-receipt");
  assert.equal(body.paymentResponse, "missing");
  assert.doesNotMatch(cli.stdout, /0xe7aeee06329bf73781c34f8fe8d6d0d36ade6189cbab28eb392fbc67d9afb697/);
  assert.doesNotMatch(cli.stdout, /BEGIN PRIVATE KEY|PAYMENT-SIGNATURE/);
});

test("using the 402 body as settlementRef source is payment_response_missing", () => {
  const observation = load(SEEDED_402);
  assert.equal(observation.settlementRefSource, "payment_required");
  assert.throws(
    () => classifyHttp402NotPaymentResponse(observation),
    (error) => {
      assert.equal(error.reason, "payment_response_missing");
      assert.equal(refusalPayload(error).evidence, null);
      return true;
    },
  );

  const cli = run(SEEDED_402);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.accepted, false);
  assert.deepEqual(body.reasons, ["payment_response_missing"]);
  assert.equal(body.evidence, null);
  assert.equal(body.paymentResponse, "missing");
  assert.equal(body.unpaid402Class, "PAYMENT-REQUIRED");
  assert.match(body.error, /not a PAYMENT-RESPONSE settlementRef source/);
  assert.equal(body.boundary.paymentSent, false);
  assert.equal(body.boundary.paidCapture, false);
});

test("absence of PAYMENT-RESPONSE is not demand", () => {
  const cli = run(SEEDED_ABSENCE);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.accepted, false);
  assert.deepEqual(body.reasons, ["absence_is_not_demand"]);
  assert.equal(body.evidence, null);
  assert.equal(body.unpaid402Class, "PAYMENT-REQUIRED");
});

test("invented loyaltyPoints is refused", () => {
  const cli = run(SEEDED_INVENTED);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.accepted, false);
  assert.deepEqual(body.reasons, ["invented_receipt_field"]);
  assert.equal(body.evidence, null);
  assert.match(body.error, /loyaltyPoints/);
});

test("well-known receipt.x402 text is not a live PAYMENT-RESPONSE", () => {
  const cli = run(SEEDED_WELL_KNOWN);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.accepted, false);
  assert.deepEqual(body.reasons, ["payment_response_missing"]);
  assert.equal(body.evidence, null);
  assert.equal(body.unpaid402Class, "PAYMENT-REQUIRED");
});

test("HTTP 200 is not this unpaid-402 classifier", () => {
  const observation = load(PASS);
  observation.http = { status: 200, headerNames: ["payment-response"] };
  assert.throws(
    () => classifyHttp402NotPaymentResponse(observation),
    (error) => error.reason === "not_unpaid_http_402",
  );
});

test("missing existing receipt cannot mint settlementRef from the 402", () => {
  const observation = load(PASS);
  delete observation.receipt;
  assert.throws(
    () => classifyHttp402NotPaymentResponse(observation),
    (error) => {
      assert.equal(error.reason, "existing_receipt_required");
      assert.equal(refusalPayload(error).evidence, null);
      return true;
    },
  );
});

test("unpaid body that already carries transactionReference fails closed", () => {
  const observation = load(PASS);
  observation.paymentRequired.transactionReference = "0xfrom402";
  assert.throws(
    () => classifyHttp402NotPaymentResponse(observation),
    (error) => error.reason === "unpaid_402_carries_settlement_reference",
  );
});

test("string true does not bypass absence_is_not_demand", () => {
  const observation = load(SEEDED_STRING_TRUE);
  assert.equal(observation.treatAbsenceAsDemand, "true");
  assert.throws(
    () => classifyHttp402NotPaymentResponse(observation),
    (error) => error.reason === "absence_is_not_demand",
  );

  const cli = run(SEEDED_STRING_TRUE);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.accepted, false);
  assert.deepEqual(body.reasons, ["absence_is_not_demand"]);
  assert.equal(body.evidence, null);
});

test("numeric 1 and yes also raise absence-as-demand", () => {
  for (const patch of [{ demand: 1 }, { absenceMeansPaid: "yes" }, { treatUnpaidAsPaymentResponse: "true" }]) {
    const observation = load(PASS);
    Object.assign(observation, patch);
    assert.throws(
      () => classifyHttp402NotPaymentResponse(observation),
      (error) => error.reason === "absence_is_not_demand" || error.reason === "payment_response_missing",
    );
  }
});

test("http.status must be the number 402, not a coerced string or array", () => {
  for (const status of ["402", [402], "0402"]) {
    const observation = load(PASS);
    observation.http.status = status;
    assert.throws(
      () => classifyHttp402NotPaymentResponse(observation),
      (error) => error.reason === "not_unpaid_http_402",
    );
  }
});

test("x402Version string 2 is not the live number 2", () => {
  const observation = load(PASS);
  observation.paymentRequired.x402Version = "2";
  assert.throws(
    () => classifyHttp402NotPaymentResponse(observation),
    (error) => error.reason === "payment_required_version_invalid",
  );
});

test("PAYMENT-RESPONSE header is refused as present, not reported missing", () => {
  const cli = run(SEEDED_PR_HEADER);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.accepted, false);
  assert.deepEqual(body.reasons, ["unpaid_402_carries_payment_response"]);
  assert.equal(body.paymentResponse, "present");
  assert.equal(body.unpaid402Class, "PAYMENT-REQUIRED");
  assert.equal(body.evidence, null);
});

test("well-known text that only contains PAYMENT-RESPONSE is not a declaration", () => {
  const cli = run(SEEDED_WK_NEGATION);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.accepted, false);
  assert.deepEqual(body.reasons, ["well_known_receipt_x402_missing"]);
  assert.equal(body.unpaid402Class, "PAYMENT-REQUIRED");
  assert.equal(body.evidence, null);
});

test("402-shaped receipt with a fake digest is still payment_response_missing", () => {
  const cli = run(SEEDED_402_DIGEST);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.accepted, false);
  assert.deepEqual(body.reasons, ["payment_response_missing"]);
  assert.equal(body.unpaid402Class, "PAYMENT-REQUIRED");
  assert.equal(body.evidence, null);
  assert.doesNotMatch(cli.stdout, /0xfrom402body/);
});

test("--live is refused and is not opened as a filename", () => {
  const cli = spawnSync(process.execPath, [CLASSIFY, "--live"], {
    encoding: "utf8",
    cwd: join(HERE, "../../.."),
  });
  assert.equal(cli.status, 2, cli.stderr || cli.stdout);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.accepted, false);
  assert.deepEqual(body.reasons, ["live_or_payment_refused"]);
  assert.equal(body.evidence, null);
  assert.doesNotMatch(cli.stdout, /ENOENT|no such file/);
});

test("oversized observation is refused before JSON parse", () => {
  const dir = mkdtempSync(join(tmpdir(), "http402-not-pr-"));
  const file = join(dir, "too-large.json");
  writeFileSync(file, `{${" ".repeat(MAX_OBSERVATION_BYTES)}}`);
  try {
    const cli = run(file);
    assert.equal(cli.status, 1, cli.stderr || cli.stdout);
    const body = JSON.parse(cli.stdout);
    assert.equal(body.accepted, false);
    assert.deepEqual(body.reasons, ["observation_too_large"]);
    assert.equal(body.evidence, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
