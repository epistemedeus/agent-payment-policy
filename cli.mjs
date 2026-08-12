#!/usr/bin/env node
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  authorizePlan,
  createStatefulWalletPolicyObservationDraft,
  createWalletPolicyObservationDraft,
  createIntent,
  createPlan,
  evaluateOfferCoherence,
  evaluateListingIdentity,
  evaluateWalletPolicyObservations,
  evaluateStatefulWalletPolicyObservations,
  normalizeRequest,
  verifyAuthorization,
  walletPolicyObservationInputSchema,
  walletPolicyObservationOutputSchema,
  statefulWalletPolicyObservationInputSchema,
  statefulWalletPolicyObservationOutputSchema,
  offerCoherenceInputSchema,
  offerCoherenceOutputSchema,
  listingIdentityInputSchema,
  listingIdentityOutputSchema,
  serviceDeploymentEnvelopeSchema,
  serviceDeploymentStatementSchema,
  serviceDeploymentVerificationSchema,
  verifyServiceDeploymentStatement,
} from "./core.mjs";

function usage() {
  console.error("Usage: agent-payment-policy inspect-url <https-url> | inspect-json-request <https-url> <body-file> | offer-coherence-check <json-file> | offer-coherence-schema | listing-identity-check <json-file> | listing-identity-schema | service-deployment-verify <envelope-json> <public-key-pem> <observation-json> | service-deployment-schema | wallet-policy-init <profile-id> <provider> <network> <protocol> | wallet-policy-check <json-file> | wallet-policy-schema | stateful-policy-init <profile-id> <provider> <network> <protocol> | stateful-policy-check <json-file> | stateful-policy-schema | demo");
  process.exitCode = 2;
}

const [command, argument, bodyFile, thirdArgument, fourthArgument] = process.argv.slice(2);

if (command === "inspect-url" && argument) {
  console.log(JSON.stringify(normalizeRequest("GET", argument), null, 2));
} else if (command === "inspect-json-request" && argument && bodyFile) {
  const body = JSON.parse(readFileSync(bodyFile, "utf8"));
  console.log(JSON.stringify(normalizeRequest("POST", argument, { body, mediaType: "application/json" }), null, 2));
} else if (command === "offer-coherence-check" && argument) {
  const input = JSON.parse(readFileSync(argument, "utf8"));
  console.log(JSON.stringify(evaluateOfferCoherence(input), null, 2));
} else if (command === "offer-coherence-schema") {
  console.log(JSON.stringify({
    input: offerCoherenceInputSchema(),
    output: offerCoherenceOutputSchema(),
  }, null, 2));
} else if (command === "listing-identity-check" && argument) {
  const input = JSON.parse(readFileSync(argument, "utf8"));
  console.log(JSON.stringify(evaluateListingIdentity(input), null, 2));
} else if (command === "listing-identity-schema") {
  console.log(JSON.stringify({
    input: listingIdentityInputSchema(),
    output: listingIdentityOutputSchema(),
  }, null, 2));
} else if (command === "service-deployment-verify" && argument && bodyFile && thirdArgument) {
  const envelope = JSON.parse(readFileSync(argument, "utf8"));
  const publicKey = readFileSync(bodyFile, "utf8");
  const observation = JSON.parse(readFileSync(thirdArgument, "utf8"));
  console.log(JSON.stringify(verifyServiceDeploymentStatement(envelope, {
    publicKey,
    request: observation.request,
    runtimeOffer: observation.runtimeOffer,
    ...(observation.now === undefined ? {} : { now: observation.now }),
  }), null, 2));
} else if (command === "service-deployment-schema") {
  console.log(JSON.stringify({
    statement: serviceDeploymentStatementSchema(),
    envelope: serviceDeploymentEnvelopeSchema(),
    verification: serviceDeploymentVerificationSchema(),
  }, null, 2));
} else if (command === "wallet-policy-init" && argument && bodyFile && thirdArgument && fourthArgument) {
  console.log(JSON.stringify(createWalletPolicyObservationDraft({
    profileId: argument,
    provider: bodyFile,
    network: thirdArgument,
    protocol: fourthArgument,
  }), null, 2));
} else if (command === "wallet-policy-check" && argument) {
  const input = JSON.parse(readFileSync(argument, "utf8"));
  console.log(JSON.stringify(evaluateWalletPolicyObservations(input), null, 2));
} else if (command === "wallet-policy-schema") {
  console.log(JSON.stringify({
    input: walletPolicyObservationInputSchema(),
    output: walletPolicyObservationOutputSchema(),
  }, null, 2));
} else if (command === "stateful-policy-init" && argument && bodyFile && thirdArgument && fourthArgument) {
  console.log(JSON.stringify(createStatefulWalletPolicyObservationDraft({
    profileId: argument,
    provider: bodyFile,
    network: thirdArgument,
    protocol: fourthArgument,
  }), null, 2));
} else if (command === "stateful-policy-check" && argument) {
  const input = JSON.parse(readFileSync(argument, "utf8"));
  console.log(JSON.stringify(evaluateStatefulWalletPolicyObservations(input), null, 2));
} else if (command === "stateful-policy-schema") {
  console.log(JSON.stringify({
    input: statefulWalletPolicyObservationInputSchema(),
    output: statefulWalletPolicyObservationOutputSchema(),
  }, null, 2));
} else if (command === "demo") {
  const now = Date.now();
  const intent = createIntent({
    purposeId: "demo.machine.need",
    need: "obtain one deterministic mock result",
    output: { requiredFields: ["data.value"] },
    economics: { expectedValueAtomic: "10000", maxTotalCostAtomic: "5000" },
    policy: { maxAtomic: "1000", dailyCapAtomic: "2000", allowedProtocols: ["x402"], protocolPreference: ["x402"] },
  }, { now });
  const plan = createPlan({ intent, offers: [{ protocol: "x402", method: "GET", url: "https://example.com/mock?input=demo", amountAtomic: "1000", recipient: "0x2222222222222222222222222222222222222222", network: "eip155:8453", asset: "USDC", expiresAt: new Date(now + 60_000).toISOString() }], now });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const envelope = authorizePlan(plan, { privateKey, kid: "ephemeral-demo", now });
  const authorization = verifyAuthorization(envelope, { publicKey, plan, now: now + 1 });
  console.log(JSON.stringify({ intent, plan, authorization, walletLoaded: false, paymentSigned: false, paymentSent: false }, null, 2));
} else {
  usage();
}
