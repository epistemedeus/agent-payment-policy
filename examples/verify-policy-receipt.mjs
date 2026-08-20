#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const NOW = Date.parse("2026-08-20T16:00:00.000Z");
const SELLER = "https://seller.example";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const OUTPUT_SCHEMA = Object.freeze({
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
});
const PAID_BODY = Object.freeze({
  data: {
    value: 42,
    source: "https://seller.example/source",
  },
});

async function loadPolicy() {
  try {
    return await import("agent-payment-policy");
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return import(new URL("../core.mjs", import.meta.url));
  }
}

export function loadFixture() {
  return JSON.parse(readFileSync(new URL("./fixtures/policy-authorization.json", import.meta.url), "utf8"));
}

export function buildPlan(policy) {
  const inspection = policy.inspectOutputSchema({
    schema: OUTPUT_SCHEMA,
    requiredFields: ["data.value", "data.source"],
  });
  const intent = policy.createIntent({
    purposeId: "buyer.adoption.verify",
    need: "verify one fixture policy authorization and bind a public-safe receipt",
    output: {
      mediaType: "application/json",
      requiredFields: ["data.value", "data.source"],
      maxResponseBytes: 10_000,
      schemaDigest: inspection.schemaDigest,
    },
    economics: {
      expectedValueAtomic: "100000",
      integrationCostAtomic: "1000",
      verificationCostAtomic: "1000",
      riskReserveAtomic: "3000",
      maxTotalCostAtomic: "50000",
    },
    policy: {
      maxAtomic: "25000",
      dailyCapAtomic: "30000",
      allowedProtocols: ["x402", "mpp"],
      protocolPreference: ["x402", "mpp"],
      buyerAddress: "0x1111111111111111111111111111111111111111",
      ownedOrigins: ["https://owned.example"],
    },
  }, { now: NOW });
  const plan = policy.createPlan({
    intent,
    offers: [{
      protocol: "x402",
      method: "GET",
      url: `${SELLER}/data?asset=ETH`,
      amountAtomic: "10000",
      recipient: RECIPIENT,
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      expiresAt: new Date(NOW + 120_000).toISOString(),
    }],
    now: NOW,
  });
  return { now: NOW, inspection, intent, plan, schema: OUTPUT_SCHEMA };
}

export async function run(policyModule) {
  const policy = policyModule || await loadPolicy();
  const fixture = loadFixture();
  const { inspection, plan } = buildPlan(policy);
  if (plan.planId !== fixture.planId) {
    throw new Error("fixture planId does not match the reconstructed plan");
  }
  if (inspection.schemaDigest !== fixture.schemaDigest) {
    throw new Error("fixture schemaDigest does not match the reconstructed buyer schema");
  }

  const authorization = policy.verifyAuthorization(fixture.envelope, {
    publicKey: fixture.publicKeyPem,
    plan,
    now: NOW + 1_000,
  });
  const outputSchemaValidator = policy.prepareOutputValidator({
    schema: OUTPUT_SCHEMA,
    contract: plan.output,
  });
  // Fixture label only. createReceipt binds a caller-supplied reference; it
  // does not observe a chain, wallet, or facilitator.
  const receipt = policy.createReceipt({
    plan,
    authorization,
    amountAtomic: plan.selected.amountAtomic,
    transactionReference: "0xadoptionfixture",
    response: PAID_BODY,
    outputSchemaValidator,
    now: NOW + 2_000,
  });
  // Synthetic classifier input. Production adapters must map independently
  // verified receipt, transaction, and balance facts; copying these match
  // states would mint a reconciled report without settlement verification.
  const syntheticCompletenessObservation = Object.freeze({
    schemaVersion: policy.SCHEMAS.receiptCompletenessObservation,
    protocol: plan.selected.protocol,
    receipt: Object.freeze({
      present: true,
      success: "confirmed",
      transactionReference: "match",
      amount: "match",
      network: "match",
      asset: "match",
      recipient: "match",
      payer: "match",
    }),
    transaction: Object.freeze({
      checked: true,
      success: "confirmed",
      transactionReference: "match",
      amount: "match",
      network: "match",
      asset: "match",
      recipient: "match",
      payer: "match",
    }),
    balance: Object.freeze({
      checked: true,
      delta: "match",
      asset: "match",
      payer: "match",
    }),
    outputValidation: receipt.output.valid ? "passed" : "failed",
  });
  const completeness = policy.evaluateReceiptCompleteness(syntheticCompletenessObservation);

  return {
    authorization: {
      authorizationId: authorization.authorizationId,
      planId: authorization.planId,
      protocol: authorization.protocol,
      maxAmountAtomic: authorization.maxAmountAtomic,
      network: authorization.network,
    },
    receipt: {
      receiptId: receipt.receiptId,
      publicRoute: receipt.request.publicRoute,
      queryKeys: receipt.request.queryKeys,
      settlement: receipt.settlement,
      output: receipt.output,
    },
    completeness: {
      state: completeness.state,
      deliveryState: completeness.deliveryState,
      provenDimensions: completeness.provenDimensions,
      missingDimensions: completeness.missingDimensions,
      conflicts: completeness.conflicts,
      supplementedBy: completeness.supplementedBy,
      evidenceBoundary: completeness.evidenceBoundary,
      rawEvidenceRetained: completeness.rawEvidenceRetained,
      credentialsUsed: completeness.credentialsUsed,
      walletAccessed: completeness.walletAccessed,
      paymentSigned: completeness.paymentSigned,
      paymentSent: completeness.paymentSent,
    },
    boundary: {
      credentialsUsed: false,
      networkAccessed: false,
      walletAccessed: false,
      paymentSigned: false,
      paymentSent: false,
      policyAuthorizationVerified: true,
      completenessObservationsSynthetic: true,
      statement: "Verifies a frozen policy authorization fixture and binds a receipt. Completeness observations are a synthetic fixture classifier, not chain, wallet, or facilitator evidence. It does not load a wallet, sign a payment, or send a payment.",
    },
  };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = await run();
  console.log(JSON.stringify(result, null, 2));
}
