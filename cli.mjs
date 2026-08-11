#!/usr/bin/env node
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  authorizePlan,
  createIntent,
  createPlan,
  normalizeRequest,
  verifyAuthorization,
} from "./core.mjs";

function usage() {
  console.error("Usage: agent-payment-policy inspect-url <https-url> | inspect-json-request <https-url> <body-file> | demo");
  process.exitCode = 2;
}

const [command, argument, bodyFile] = process.argv.slice(2);

if (command === "inspect-url" && argument) {
  console.log(JSON.stringify(normalizeRequest("GET", argument), null, 2));
} else if (command === "inspect-json-request" && argument && bodyFile) {
  const body = JSON.parse(readFileSync(bodyFile, "utf8"));
  console.log(JSON.stringify(normalizeRequest("POST", argument, { body, mediaType: "application/json" }), null, 2));
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
