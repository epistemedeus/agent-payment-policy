#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const NOW = Date.parse("2026-08-20T16:00:00.000Z");
const SELLER = "https://seller.example";
const ROUTE = "/data";
const X402_RECIPIENT = "0x2222222222222222222222222222222222222222";
const MPP_RECIPIENT = "tempo-account-seller-1";
const BUYER_ADDRESS = "0x1111111111111111111111111111111111111111";
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

async function loadPolicy() {
  try {
    return await import("agent-payment-policy");
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return import(new URL("../core.mjs", import.meta.url));
  }
}

function mockOffer({ protocol, amountAtomic, recipient, network, asset, url = `${SELLER}${ROUTE}?asset=ETH` }) {
  return {
    protocol,
    method: "GET",
    url,
    amountAtomic,
    recipient,
    network,
    asset,
    expiresAt: new Date(NOW + 120_000).toISOString(),
  };
}

function coherenceObservation(source, offer) {
  // Mock only: catalog and runtime are the same caller-supplied offer. A
  // production adapter must compare a catalog record to a separately fetched
  // live unsigned challenge.
  return {
    schemaVersion: "agent-payment-policy.offer-coherence-observation.v1",
    catalog: { source, ...offer },
    runtime: { ...offer },
  };
}

export async function run(policyModule) {
  const policy = policyModule || await loadPolicy();
  const {
    SCHEMAS,
    createIntent,
    createPlan,
    createPurchaseEvidenceManifest,
    evaluateListingIdentity,
    evaluateOfferCoherence,
    evaluateResponseContract,
    inspectOutputSchema,
    verifyPurchaseEvidenceManifest,
  } = policy;

  const x402 = mockOffer({
    protocol: "x402",
    amountAtomic: "10000",
    recipient: X402_RECIPIENT,
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  });
  const mpp = mockOffer({
    protocol: "mpp",
    amountAtomic: "9000",
    recipient: MPP_RECIPIENT,
    network: "tempo:mainnet",
    asset: "pathUSD",
  });

  const listingIdentity = evaluateListingIdentity({
    schemaVersion: SCHEMAS.listingIdentityObservation,
    target: { canonicalOrigin: SELLER, route: ROUTE },
    records: [
      { source: "mock-catalog-x402", url: x402.url, rank: 1 },
      { source: "mock-catalog-mpp", url: mpp.url, rank: 2 },
    ],
  }, { now: NOW });

  const coherence = {
    x402: evaluateOfferCoherence(coherenceObservation("mock-catalog-x402", x402), { now: NOW }),
    mpp: evaluateOfferCoherence(coherenceObservation("mock-catalog-mpp", mpp), { now: NOW }),
  };

  const responseContract = evaluateResponseContract({
    schemaVersion: SCHEMAS.responseContractObservation,
    source: "seller_declaration",
    request: { method: "GET", url: x402.url },
    response: {
      status: 200,
      mediaType: "application/json",
      schema: OUTPUT_SCHEMA,
      example: { data: { value: 42, source: "https://seller.example/source" } },
    },
  }, { now: NOW });

  const outputSchema = inspectOutputSchema({
    schema: OUTPUT_SCHEMA,
    requiredFields: ["data.value", "data.source"],
  });

  const manifest = createPurchaseEvidenceManifest({
    service: { origin: SELLER, version: "1.0.0" },
    protocols: ["x402", "mpp"],
    evidence: { deployment: `${SELLER}/.well-known/deployment.json` },
    operations: [{
      method: "GET",
      path: ROUTE,
      effect: "read_only",
      output: {
        mediaType: "application/json",
        schemaDigest: outputSchema.schemaDigest,
        requiredPaths: ["data", "data.value", "data.source"],
        declaration: "seller_declared",
      },
      replay: { requestBinding: ["method", "canonical_url"] },
      receipt: { x402: "PAYMENT-RESPONSE", mpp: "Payment-Receipt", runtimeValidationRequired: true },
    }],
    boundary: { claims: "seller_declared_until_independently_verified" },
  });
  const purchaseEvidence = verifyPurchaseEvidenceManifest(manifest, {
    target: x402.url,
    method: "GET",
    requiredPaths: ["data.value", "data.source"],
  });

  const intent = createIntent({
    purposeId: "buyer.adoption.preflight",
    need: "select one mock paid observation before any wallet or signing work",
    output: {
      mediaType: "application/json",
      requiredFields: ["data.value", "data.source"],
      maxResponseBytes: 10_000,
      schemaDigest: outputSchema.schemaDigest,
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
      buyerAddress: BUYER_ADDRESS,
      ownedOrigins: ["https://owned.example"],
    },
  }, { now: NOW });

  const plan = createPlan({
    intent,
    offers: [
      x402,
      mpp,
      mockOffer({
        protocol: "x402",
        amountAtomic: "26000",
        recipient: X402_RECIPIENT,
        network: "eip155:8453",
        asset: x402.asset,
      }),
      mockOffer({
        protocol: "x402",
        amountAtomic: "8000",
        recipient: BUYER_ADDRESS,
        network: "eip155:8453",
        asset: x402.asset,
      }),
      mockOffer({
        protocol: "mpp",
        amountAtomic: "7000",
        recipient: MPP_RECIPIENT,
        network: "tempo:mainnet",
        asset: "pathUSD",
        url: "https://owned.example/data?asset=ETH",
      }),
    ],
    now: NOW,
  });

  return {
    listingIdentity: {
      decision: listingIdentity.decision,
      nextAction: listingIdentity.nextAction,
      boundary: listingIdentity.boundary,
    },
    coherence: {
      x402: {
        decision: coherence.x402.decision,
        nextAction: coherence.x402.nextAction,
        boundary: coherence.x402.boundary,
      },
      mpp: {
        decision: coherence.mpp.decision,
        nextAction: coherence.mpp.nextAction,
        boundary: coherence.mpp.boundary,
      },
    },
    responseContract: {
      decision: responseContract.decision,
      requiredPaths: responseContract.requiredPaths,
      schemaDigest: responseContract.schemaDigest,
      boundary: responseContract.boundary,
    },
    outputSchema: {
      decision: outputSchema.decision,
      schemaDigest: outputSchema.schemaDigest,
      requiredPaths: outputSchema.requiredPaths,
      schemaRetained: outputSchema.schemaRetained,
      credentialsUsed: outputSchema.credentialsUsed,
      walletAccessed: outputSchema.walletAccessed,
      paymentSigned: outputSchema.paymentSigned,
      paymentSent: outputSchema.paymentSent,
    },
    purchaseEvidence: {
      status: purchaseEvidence.status,
      declaration: purchaseEvidence.declaration,
      serviceVersion: purchaseEvidence.serviceVersion,
      manifestDigest: purchaseEvidence.manifestDigest,
      requiredPaths: purchaseEvidence.requiredPaths,
    },
    plan: {
      decision: plan.decision,
      selected: plan.selected && {
        protocol: plan.selected.protocol,
        publicRoute: plan.selected.request.publicRoute,
        queryKeys: plan.selected.request.queryKeys,
        amountAtomic: plan.selected.amountAtomic,
        network: plan.selected.network,
        asset: plan.selected.asset,
      },
      killed: plan.killed,
    },
    boundary: {
      credentialsUsed: false,
      networkAccessed: false,
      walletAccessed: false,
      paymentSigned: false,
      paymentSent: false,
      policyAuthorizationCreated: false,
      catalogEqualsRuntime: true,
      purchaseEvidenceIndependentlyFetched: false,
      statement: "Mock x402 and MPP preflight over caller-supplied offers. Catalog and runtime are the same mock object, and purchase evidence is caller-built, not fetched. It does not fetch, authenticate, authorize, sign, or send a payment.",
    },
  };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = await run();
  console.log(JSON.stringify(result, null, 2));
}
