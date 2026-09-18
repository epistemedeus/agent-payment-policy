import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  BOUNDARY,
  EQUALITY_SCHEMA,
  compareOfferSettlement,
  extractOfferPayload,
  projectOfferSettlement,
  refusalPayload,
} from "./offer-settlement-gate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const GATE = join(HERE, "offer-settlement-gate.mjs");
const FIXTURES = join(HERE, "fixtures");

function loadFixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

function runGate(args) {
  return spawnSync(process.execPath, [GATE, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
}

function parseCli(result) {
  return JSON.parse(result.stdout);
}

test("matching live payload amount 5000 equals createReceipt.settlement amountAtomic 5000", () => {
  const fixture = loadFixture("matching-offer-settlement.json");
  const payload = extractOfferPayload(fixture);
  assert.equal(payload.amount, "5000");
  assert.equal(payload.network, "eip155:8453");
  assert.equal(payload.payTo, "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee");

  const projection = projectOfferSettlement(fixture);
  assert.equal(projection.accepted, true);
  assert.equal(projection.evidence.schemaVersion, EQUALITY_SCHEMA);
  assert.equal(projection.evidence.compared.amount.payload, "5000");
  assert.equal(projection.evidence.compared.amount.settlement, "5000");
  assert.equal(projection.evidence.compared.amount.equal, true);
  assert.equal(projection.evidence.compared.network.equal, true);
  assert.equal(projection.evidence.compared.asset.equal, true);
  assert.equal(projection.evidence.compared.payTo.payload, payload.payTo);
  assert.equal(projection.evidence.compared.payTo.settlement, fixture.receipt.settlement.recipient);
  assert.equal(projection.evidence.settlementRef, "0xcreate-receipt-settlement-fixture");
  assert.equal(projection.boundary.sellerSignatureVerified, false);
  assert.equal(projection.boundary.paymentSent, false);
  assert.equal(projection.boundary.unitConverted, false);
  assert.deepEqual(projection.boundary, BOUNDARY);
  assert.doesNotMatch(JSON.stringify(projection.evidence), /resourceUrl|loyaltyPoints|PAYMENT-SIGNATURE/);

  const cli = runGate(["examples/portable-evidence/fixtures/matching-offer-settlement.json"]);
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  const body = parseCli(cli);
  assert.equal(body.accepted, true);
  assert.equal(body.evidence.compared.amount.payload, "5000");
  assert.equal(body.evidence.compared.amount.settlement, "5000");
});

test("seeded payload.amount 1 against settlement 5000 is offer_settlement_mismatch", () => {
  const fixture = loadFixture("seeded-amount-mismatch.json");
  assert.equal(fixture.paymentRequired.accepts[0].amount, "5000");
  assert.equal(fixture.paymentRequired.extensions["offer-receipt"].info.offers[0].payload.amount, "1");
  assert.equal(fixture.receipt.settlement.amountAtomic, "5000");

  assert.throws(
    () => projectOfferSettlement(fixture),
    (error) => {
      assert.equal(error.reason, "offer_settlement_mismatch");
      assert.equal(error.extra.mismatches[0].field, "amount");
      assert.equal(error.extra.mismatches[0].payload, "1");
      assert.equal(error.extra.mismatches[0].settlement, "5000");
      const payload = refusalPayload(error);
      assert.equal(payload.accepted, false);
      assert.equal(payload.evidence, null);
      assert.deepEqual(payload.reasons, ["offer_settlement_mismatch"]);
      return true;
    },
  );

  const cli = runGate(["examples/portable-evidence/fixtures/seeded-amount-mismatch.json"]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = parseCli(cli);
  assert.equal(body.accepted, false);
  assert.equal(body.evidence, null);
  assert.deepEqual(body.reasons, ["offer_settlement_mismatch"]);
  assert.equal(body.mismatches[0].payload, "1");
  assert.equal(body.mismatches[0].settlement, "5000");
  assert.equal(body.boundary.sellerSignatureVerified, false);
  assert.doesNotMatch(cli.stdout, /BEGIN PRIVATE KEY|PAYMENT-SIGNATURE/);
});

test("missing payload amount is mismatch, not demand", () => {
  const fixture = loadFixture("seeded-missing-payload-amount.json");
  const cli = runGate(["examples/portable-evidence/fixtures/seeded-missing-payload-amount.json"]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = parseCli(cli);
  assert.equal(body.evidence, null);
  assert.deepEqual(body.reasons, ["offer_settlement_mismatch"]);
  const amount = body.mismatches.find((row) => row.field === "amount");
  assert.equal(amount.payload, null);
  assert.equal(amount.settlement, fixture.receipt.settlement.amountAtomic);
  assert.equal(amount.absenceIsNotMatch, true);
});

test("invented loyaltyPoints bind field is refused", () => {
  const cli = runGate(["examples/portable-evidence/fixtures/seeded-invented-field.json"]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = parseCli(cli);
  assert.equal(body.evidence, null);
  assert.deepEqual(body.reasons, ["invented_receipt_field"]);
  assert.deepEqual(body.invented, ["loyaltyPoints"]);
  assert.doesNotMatch(cli.stdout, /"loyaltyPoints": 99/);
});

test("numeric or converted amounts are not equal", () => {
  const result = compareOfferSettlement(
    { amount: 5000, network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee" },
    { amountAtomic: "5000", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", recipient: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee" },
  );
  assert.equal(result.equal, false);
  assert.equal(result.mismatches[0].field, "amount");
});

test("--create-receipt binds adoption createReceipt.settlement and accepts an aligned offer", async () => {
  const cli = runGate([
    "--create-receipt",
    "examples/portable-evidence/fixtures/create-receipt-aligned-offer.json",
  ]);
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  const body = parseCli(cli);
  assert.equal(body.accepted, true);
  assert.equal(body.createReceiptBound, true);
  assert.equal(body.evidence.settlementSource, "createReceipt");
  assert.equal(body.evidence.compared.amount.payload, "10000");
  assert.equal(body.evidence.compared.amount.settlement, "10000");
  assert.equal(body.evidence.compared.payTo.settlement, "0x2222222222222222222222222222222222222222");
  assert.equal(body.evidence.settlementRef, "0xadoptionfixture");
  assert.equal(body.boundary.sellerSignatureVerified, false);
});

test("--create-receipt rejects live 402 amount 5000 against adoption settlement 10000", () => {
  const cli = runGate([
    "--create-receipt",
    "examples/portable-evidence/fixtures/live-402-offer-receipt.json",
  ]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = parseCli(cli);
  assert.equal(body.accepted, false);
  assert.equal(body.evidence, null);
  assert.deepEqual(body.reasons, ["offer_settlement_mismatch"]);
  assert.equal(body.createReceiptBound, true);
  const amount = body.mismatches.find((row) => row.field === "amount");
  assert.equal(amount.payload, "5000");
  assert.equal(amount.settlement, "10000");
  const payTo = body.mismatches.find((row) => row.field === "payTo");
  assert.equal(payTo.payload, "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee");
  assert.equal(payTo.settlement, "0x2222222222222222222222222222222222222222");
});

test("usage without a fixture exits 2", () => {
  const cli = runGate([]);
  assert.equal(cli.status, 2, cli.stderr || cli.stdout);
  assert.match(cli.stderr, /Usage:/);
});

test("unpaid 402 with injected matching settlement is unpaid_402_is_not_settlement", () => {
  const fixture = loadFixture("seeded-402-injected-settlement.json");
  assert.equal(fixture.settlement.amountAtomic, "5000");
  assert.equal(fixture.extensions["offer-receipt"].info.offers[0].payload.amount, "5000");

  assert.throws(
    () => projectOfferSettlement(fixture),
    (error) => {
      assert.equal(error.reason, "unpaid_402_is_not_settlement");
      const payload = refusalPayload(error);
      assert.equal(payload.accepted, false);
      assert.equal(payload.evidence, null);
      assert.deepEqual(payload.reasons, ["unpaid_402_is_not_settlement"]);
      return true;
    },
  );

  const cli = runGate(["examples/portable-evidence/fixtures/seeded-402-injected-settlement.json"]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = parseCli(cli);
  assert.equal(body.accepted, false);
  assert.equal(body.evidence, null);
  assert.deepEqual(body.reasons, ["unpaid_402_is_not_settlement"]);
  assert.doesNotMatch(cli.stdout, /0xforged-from-unpaid-402/);
});

test("402 envelope used as receipt is unpaid_402_is_not_settlement", () => {
  const cli = runGate(["examples/portable-evidence/fixtures/seeded-402-envelope-as-receipt.json"]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = parseCli(cli);
  assert.equal(body.accepted, false);
  assert.equal(body.evidence, null);
  assert.deepEqual(body.reasons, ["unpaid_402_is_not_settlement"]);
  assert.doesNotMatch(cli.stdout, /0xforged-402-as-receipt/);
});

test("unknown bind field discountCode is invented_receipt_field", () => {
  const cli = runGate(["examples/portable-evidence/fixtures/seeded-unknown-bind-field.json"]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = parseCli(cli);
  assert.equal(body.evidence, null);
  assert.deepEqual(body.reasons, ["invented_receipt_field"]);
  assert.deepEqual(body.invented, ["discountCode"]);
});

test("allowlisted bindFields amount is not invented", () => {
  const fixture = loadFixture("matching-offer-settlement.json");
  fixture.bindFields = ["amount"];
  const projection = projectOfferSettlement(fixture);
  assert.equal(projection.accepted, true);
  assert.equal(projection.evidence.compared.amount.equal, true);
});

test("overlong payload amount is mismatch, not converted", () => {
  const result = compareOfferSettlement(
    {
      amount: `5000${"0".repeat(200)}`,
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
    },
    {
      amountAtomic: "5000",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      recipient: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
    },
  );
  assert.equal(result.equal, false);
  assert.equal(result.mismatches[0].field, "amount");
  assert.equal(result.mismatches[0].payload, null);
  assert.equal(result.mismatches[0].absenceIsNotMatch, true);
});

test("live 402 without a separate receipt is existing_receipt_required", () => {
  const cli = runGate(["examples/portable-evidence/fixtures/live-402-offer-receipt.json"]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = parseCli(cli);
  assert.equal(body.accepted, false);
  assert.equal(body.evidence, null);
  assert.deepEqual(body.reasons, ["existing_receipt_required"]);
});

test("invalid JSON is projection_input_invalid", () => {
  const cli = runGate(["examples/portable-evidence/offer-settlement-gate.mjs"]);
  assert.equal(cli.status, 1, cli.stderr || cli.stdout);
  const body = parseCli(cli);
  assert.equal(body.accepted, false);
  assert.equal(body.evidence, null);
  assert.deepEqual(body.reasons, ["projection_input_invalid"]);
});
