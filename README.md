# agent-payment-policy

[![verify](https://github.com/epistemedeus/agent-payment-policy/actions/workflows/ci.yml/badge.svg)](https://github.com/epistemedeus/agent-payment-policy/actions/workflows/ci.yml)

Credential-free policy and evidence primitives for machine buyers that use x402
or MPP.

Use it when an AI agent needs to turn a private purchase need into a bounded
payment plan, reject incompatible x402 or MPP offers, authorize one exact
request separately from execution, and produce a public-safe payment receipt.
It is a buyer policy layer, not a wallet, facilitator, or seller proxy.

The package separates five concerns:

1. A private machine need becomes an immutable intent digest.
2. External offers are filtered by exact request, value, capital, ownership, and
   expiry constraints.
3. A separate Ed25519 policy identity authorizes one exact plan.
4. A second short-lived authorization can bind the complete signing action,
   including every call in a batch, after runtime payment terms are known.
5. A public-safe receipt binds settlement and output evidence without retaining
   query values, JSON request bodies, or response bodies.

It also exposes a wallet-free control-coverage gate for delegated signers. A
settlement adapter can declare where each of fourteen required controls is
enforced, then reject the profile unless every pre-signature and
post-settlement control is covered by the provider, the independent buyer, or
both. The result uses explicit dispositions rather than a security score.

It contains no wallet executor, payment signer, facilitator credential, seller
key, RPC key, live project identity, or default wallet path. It cannot move
funds.

Version 0.13.0 adds an optional buyer-owned acceptance-schema boundary. The
buyer can inspect a local JSON Schema, bind its canonical SHA-256 digest into an
intent, prepare an exact validator before wallet access, and require the actual
paid output to satisfy that same schema when creating a receipt. The schema is
not copied into the intent, plan, authorization, receipt, or network request.
Contracts without `schemaDigest` retain the prior required-field behavior.

Version 0.13.1 adds a neutral installable agent skill for applying that boundary
to x402, MPP, HTTP 402, paid API, and paid MCP workflows. The skill complements
wallet and payment-execution tools. It does not authorize spend or move funds.

## Try it

```bash
npm install agent-payment-policy
npx agent-payment-policy demo
npx agent-payment-policy inspect-url 'https://example.com/data?asset=ETH'
npx agent-payment-policy inspect-json-request 'https://example.com/analyze' ./request.json
npx agent-payment-policy output-schema-check ./output-schema.json data.value,data.source
```

The demo generates an ephemeral policy key and produces a plan plus a verified
authorization. It performs no network request and no payment. Running the CLI
with no command prints usage and does not generate keys, sign, or pay.

## Five-minute local adoption

Pack this repository (or install a later npm release that includes `examples/`)
and run the two credential-free examples. Published `0.14.0` does not ship them.
They use mock x402 and MPP offers plus a frozen policy-authorization fixture.
They do not fetch, load a wallet, sign a payment, or send a payment.

```bash
npm pack --ignore-scripts
npm install ./agent-payment-policy-0.14.0.tgz
node node_modules/agent-payment-policy/examples/mock-x402-mpp-preflight.mjs
node node_modules/agent-payment-policy/examples/verify-policy-receipt.mjs
```

The preflight example filters mock offers and selects one plan. The verification
example checks a committed policy authorization, binds a public-safe receipt,
and classifies synthetic completeness observations. That completeness report is
not chain or wallet evidence. See [`examples/README.md`](examples/README.md).

## Install the agent skill

```bash
npx skills add epistemedeus/agent-payment-policy@agent-payment-policy
```

The skill teaches an agent to define a buyer-owned JSON Schema, bind its exact
digest through intent and authorization, and validate the settled body before
accepting delivery. It is also included in the npm package at
`skills/agent-payment-policy/SKILL.md`.

## Bind the output you are willing to buy

```js
import { readFile } from "node:fs/promises";
import {
  createIntent,
  createReceipt,
  inspectOutputSchema,
  prepareOutputValidator,
} from "agent-payment-policy";

const schema = JSON.parse(await readFile("./output-schema.json", "utf8"));
const inspected = inspectOutputSchema({
  schema,
  requiredFields: ["data.value", "data.source"],
});

const intent = createIntent({
  // other private need, economics, and policy fields
  output: {
    mediaType: "application/json",
    requiredFields: ["data.value", "data.source"],
    maxResponseBytes: 100_000,
    schemaDigest: inspected.schemaDigest,
  },
});

// Compile before wallet or signing work.
const outputSchemaValidator = prepareOutputValidator({
  schema,
  contract: intent.output,
});

const receipt = createReceipt({
  plan,
  authorization,
  amountAtomic,
  transactionReference,
  response,
  outputSchemaValidator,
});
```

`inspectOutputSchema` accepts only the same bounded, self-contained response
schema subset used by the pre-purchase contract evaluator. It also compiles the
schema with strict JSON Schema 2020-12 plus standard formats. The prepared
validator is capability-like and bound to one digest; a different or missing
validator fails closed when the intent includes `schemaDigest`.

## Classify receipt completeness

Provider receipts, chain receipts, and buyer balance evidence frequently carry
different parts of the settlement fact. Normalize already verified facts into
controlled match states and classify them without retaining raw headers,
signatures, paid bodies, credentials, or wallet secrets:

```js
import { evaluateReceiptCompleteness, SCHEMAS } from "agent-payment-policy";

const report = evaluateReceiptCompleteness({
  schemaVersion: SCHEMAS.receiptCompletenessObservation,
  protocol: "x402",
  receipt: {
    present: true,
    success: "confirmed",
    transactionReference: "match",
    amount: "missing",
    network: "match",
    asset: "match",
    recipient: "match",
    payer: "match"
  },
  transaction: {
    checked: true,
    success: "confirmed",
    transactionReference: "match",
    amount: "not_checked",
    network: "match",
    asset: "match",
    recipient: "match",
    payer: "match"
  },
  balance: {
    checked: true,
    delta: "match",
    asset: "match",
    payer: "match"
  },
  outputValidation: "passed"
});
```

The report distinguishes `reconciled`, `partial`, `conflict`, and
`insufficient`; lists proven and missing dimensions; and says whether
transaction or balance evidence supplemented the provider receipt. The caller
must verify every input fact first. This evaluator does not parse a raw receipt,
verify a transaction or signature, authorize payment, access a wallet, or prove
independent demand.

For a local file:

```bash
npx agent-payment-policy receipt-completeness-check ./observation.json
npx agent-payment-policy receipt-completeness-schema
```

## Gate a delegated signer

```js
import {
  assertControlCoverage,
  createControlCoverage,
  PAYMENT_CONTROL_DIMENSIONS,
} from "agent-payment-policy";

const coverage = createControlCoverage({
  profileId: "tempo-pathusd",
  provider: "your-signer",
  network: "eip155:42431",
  protocol: "mpp-tempo-charge",
  independentVerified: [...PAYMENT_CONTROL_DIMENSIONS],
});

assertControlCoverage(coverage, {
  profileId: "tempo-pathusd",
  provider: "your-signer",
  network: "eip155:42431",
  protocol: "mpp-tempo-charge",
});
```

Call the assertion before account access, wallet loading, signing, or payment.
The report is evidence about enforcement placement, not proof that a declared
control is implemented correctly. Bind profiles in reviewed code, test each
control against drift, and retain the underlying acceptance evidence.

`operation` answers which RPC or signing method may run. `execution_shape`
separately answers whether the complete action, including batch cardinality and
ordering, is fixed. Do not credit method allowlisting as execution-shape
coverage.

## Bind the exact execution batch

Provider policies often constrain a signing method, contract, function, and
arguments without constraining how many calls appear in a batched transaction.
Use a second short-lived execution authorization after the transaction has been
built and independently reviewed:

```js
import {
  authorizeExecution,
  verifyExecutionAuthorization,
} from "agent-payment-policy";

const executionEnvelope = authorizeExecution({
  authorization, // output of verifyAuthorization
  method: "eth_signTransaction",
  network: "eip155:42431",
  action: unsignedTransaction,
}, { privateKey: policyPrivateKey, kid: "policy-execution-1" });

const executionAuthorization = verifyExecutionAuthorization(executionEnvelope, {
  publicKey: policyPublicKey,
  authorization,
  method: "eth_signTransaction",
  network: "eip155:42431",
  action: unsignedTransaction,
});
```

Changing the method, network, any call, call order, call count, fee field, nonce,
validity field, calldata byte, or other JSON field invalidates the binding. The
authorization records only a canonical digest and byte count, not the action
body. This is an exact transport and signer-boundary lock. The trusted buyer
still must independently determine that the original action is safe and matches
the payment challenge.

## Safety boundary

`normalizeRequest` rejects non-HTTPS URLs, user information, nonstandard HTTPS
ports, local hostnames, literal private/reserved IPs, and credential-like query
keys. A network adapter must resolve DNS and pass every result to
`assertResolvedPublicAddresses` immediately before connecting. It must also pin
the resolved address, reject cross-origin redirects, enforce time and response
size limits, and repeat the check after every allowed redirect.

The package hashes the full private request URL for exact binding while exposing
only method, origin, path, and query-key names in plans and receipts. For JSON
POST requests, it canonicalizes the private object and additionally exposes only
the media type, byte count, and SHA-256 body digest. The request body itself is
not retained. An executor must reconstruct the canonical bytes and match the
signed request binding before sending or paying. See
[`docs/threat-model.md`](docs/threat-model.md) and
[`docs/data-handling.md`](docs/data-handling.md).

Response-contract reports keep both top-level `requiredFields` and recursively
guaranteed `requiredPaths`. A schema that requires only `data` does not promise
`data.attributes`, even when that nested property is described. Buyer policy can
therefore require exact useful paths without retaining the seller schema or
example. Reports carrying recursive paths use the immutable
`agent-payment-policy.response-contract-report.v2` identifier.

## Purchase evidence

A payment challenge says how to pay. It does not by itself say whether the
exact operation is read-only, which JSON paths the seller declares as
guaranteed, how response replay is bound, or which runtime receipts the buyer
must validate.

Version 0.12.0 adds a small credential-free contract for that gap:

```js
import {
  createPurchaseEvidenceManifest,
  purchaseEvidenceLink,
  selectPurchaseEvidenceLink,
  verifyPurchaseEvidenceManifest,
} from "agent-payment-policy";

const manifest = createPurchaseEvidenceManifest({
  service: { origin: "https://seller.example", version: "1.0.0" },
  protocols: ["x402", "mpp"],
  evidence: { deployment: "https://seller.example/.well-known/deployment.json" },
  operations: [{
    method: "GET",
    path: "/data",
    effect: "read_only",
    output: {
      mediaType: "application/json",
      schemaDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      requiredPaths: ["data", "data.value"],
      declaration: "seller_declared",
    },
    replay: { requestBinding: ["method", "canonical_url"] },
    receipt: {
      x402: "PAYMENT-RESPONSE",
      mpp: "Payment-Receipt",
      runtimeValidationRequired: true,
    },
  }],
  boundary: { claims: "seller_declared_until_independently_verified" },
});

const link = purchaseEvidenceLink(
  "https://seller.example/.well-known/agent-payment-evidence.json",
);

const manifestUrl = selectPurchaseEvidenceLink(
  link,
  "https://seller.example/data",
);

const binding = verifyPurchaseEvidenceManifest(manifest, {
  target: "https://seller.example/data",
  method: "GET",
  requiredPaths: ["data.value"],
});
```

The Link header carries both the registered `describedby` relation and the
package's exact extension relation. Generic API documentation links remain
unrelated and are ignored. The target must be same-origin, the manifest digest
is deterministic, and selection is by exact method and path.

The package performs no fetch. A network adapter still needs HTTPS, DNS and
SSRF controls, redirect rejection, byte and time limits, and a fresh read before
wallet access. The manifest is seller-declared planning evidence. It is not
permission to spend and does not replace live payment terms, output validation,
receipts, settlement, or independent trust evidence.

## Status

This is a reference implementation under active design review. It does not
claim adoption, adaptive supplier selection, wallet security, or transaction
execution. A separately reviewed adapter can use the verified authorization as
one input to its own signing policy. A control-coverage report does not make a
provider trustworthy by declaration; the integration remains responsible for
proving every claimed enforcement path.

## Standardize wallet policy observations

Version 0.5.0 added a provider-neutral observation format for the exact wallet
policy problem this project encountered on both Tempo and Solana. Provider
policies denied useful wrong-action cases while still signing a transaction
that duplicated an approved action. The format therefore treats `operation`
and `execution_shape` as separate controls.

Create a safe offline draft matrix:

```bash
agent-payment-policy wallet-policy-init \
  provider-lab "Example Wallet" eip155:8453 x402 \
  > wallet-policy-observations.json
```

Replace each `not_tested` row with the high-level result from your bounded
provider test. Keep only the standardized case, `allowed`, `denied`, or
`error`, the denial class, and an optional short safe code. Do not place API
keys, wallet IDs, signatures, transaction bodies, raw provider messages, or
other evidence payloads in the file.

Evaluate it locally with no network or wallet access:

```bash
agent-payment-policy wallet-policy-check wallet-policy-observations.json
```

The result is `conformant`, `partial`, or `unsafe`, with no opaque numerical
score. Only `actual=denied` plus `denialClass=policy` receives provider-native
credit. SDK validation errors and generic provider failures remain
inconclusive. The required `duplicate_approved_action` case must be explicitly
policy-denied for exact execution shape to pass.

Print the portable JSON Schemas:

```bash
agent-payment-policy wallet-policy-schema
```

The core exports are `createWalletPolicyObservationDraft`,
`evaluateWalletPolicyObservations`, `normalizeWalletPolicyObservations`,
`WALLET_POLICY_OBSERVATION_CASES`, `walletPolicyObservationInputSchema`, and
`walletPolicyObservationOutputSchema`.

These APIs evaluate caller-supplied observations. They do not execute or prove
the provider tests, access a wallet, verify a signature, sign, broadcast, or
settle a payment.

## Standardize stateful budget observations

Version 0.6.0 adds a separate seven-case format for wallet policies that depend
on prior or concurrent requests. It does not fold stateful behavior into exact-
action conformance because they answer different questions.

Create and evaluate a safe offline draft:

```bash
agent-payment-policy stateful-policy-init \
  provider-budget-lab "Example Wallet" eip155:8453 x402 \
  > stateful-policy-observations.json

agent-payment-policy stateful-policy-check stateful-policy-observations.json
agent-payment-policy stateful-policy-schema
```

The required cases are one request inside the cap, a sequential request that
exceeds the cumulative cap, signed-but-unbroadcast accounting, unrecognized
calldata, concurrent oversubscription, and a missing counter reference. An
optional case records application-side serialization separately. A local mutex,
queue, or rate limiter can be useful but never receives provider-native credit.
The output is `conformant`, `partial`, or `unsafe` and has no opaque score.

The core exports are `createStatefulWalletPolicyObservationDraft`,
`evaluateStatefulWalletPolicyObservations`,
`normalizeStatefulWalletPolicyObservations`,
`STATEFUL_WALLET_POLICY_OBSERVATION_CASES`,
`statefulWalletPolicyObservationInputSchema`, and
`statefulWalletPolicyObservationOutputSchema`.

## Compare catalog metadata with the live unsigned offer

Version 0.7.0 adds the missing boundary between machine discovery and value
authorization. A registry can advertise a stale route, protocol, amount,
network, asset, recipient, or expiry even when the seller's current unsigned
x402 or MPP challenge is correct.

Create a secret-free observation file with one catalog record and one live
unsigned runtime offer, then evaluate it locally:

```bash
agent-payment-policy offer-coherence-check offer-observation.json
agent-payment-policy offer-coherence-schema
```

The runtime record must include a complete request, protocol, atomic amount,
network, asset, recipient, and unexpired absolute deadline. An x402 adapter can
derive that deadline from the challenge observation time plus
`maxTimeoutSeconds`; MPP normally supplies it directly. Catalog economics may
be missing. Missing catalog fields remain `unknown`, explicit disagreements
are `drifted`, and only complete agreement is `coherent`.

The evaluator returns `eligible_for_separate_value_and_policy_authorization`
only after every dimension agrees. It does not authorize the purchase. Feed the
coherent runtime offer into `createPlan`, then use the existing independent plan
and execution authorization layers.

Full query values and JSON request-body values remain digest-bound and absent
from the report. The evaluator makes no network request, accepts no credential,
accesses no wallet, signs nothing, and sends no payment. The core exports are
`evaluateOfferCoherence`, `offerCoherenceInputSchema`, and
`offerCoherenceOutputSchema`.

Version 0.8.0 adds a second credential-free boundary for catalog listing
identity. A buyer or seller can supply one canonical origin, exact route,
optional settlement identity, an optional list of catalogs checked, and up to
100 catalog records:

```bash
agent-payment-policy listing-identity-check listing-observation.json
agent-payment-policy listing-identity-schema
```

The evaluator classifies each catalog as `canonical`, `duplicate_records`,
`alias_only`, `alias_collision`, or `route_absent`. A non-canonical record is
an alias candidate only when it shares the exact route and caller-supplied
settlement identity. That still does not prove hostname ownership. Conflicts
return `review_required`; only a canonical result advances to a separate live
runtime-offer preflight. Declaring a checked catalog in `sources` also lets an
empty response produce an explicit `route_absent` result instead of looking
like a catalog that was never checked.

Query values and settlement-identity values are absent from the report. The
evaluator makes no network request, accepts no credential, accesses no wallet,
signs nothing, sends no payment, and never treats catalog duplication as
demand. The core exports are `evaluateListingIdentity`,
`listingIdentityInputSchema`, and `listingIdentityOutputSchema`.

Version 0.9.0 adds a signed service-deployment statement for an ambiguity that
catalog records and matching well-known files cannot resolve on their own. A
seller can bind one canonical HTTPS origin, explicitly authorized alias
origins, exact HTTP method and path pairs, and exact x402 or MPP settlement
identities in a short-lived Ed25519 JWS:

```js
import {
  createServiceDeploymentStatement,
  signServiceDeploymentStatement,
  verifyServiceDeploymentStatement,
} from "agent-payment-policy";

const statement = createServiceDeploymentStatement({
  canonicalOrigin: "https://seller.example",
  deployments: [{
    origin: "https://seller.example",
    routes: [{ method: "GET", path: "/data" }],
    settlement: [{
      protocol: "x402",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      recipient: "0x2222222222222222222222222222222222222222",
      decimals: 6,
    }],
  }, {
    origin: "https://edge.example",
    routes: [{ method: "GET", path: "/data" }],
    settlement: [{
      protocol: "x402",
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      recipient: "0x2222222222222222222222222222222222222222",
      decimals: 6,
    }],
  }],
}, { ttlMs: 86_400_000 });

const envelope = signServiceDeploymentStatement(statement, {
  privateKey,
  kid: "seller-2026-08",
});

const verification = verifyServiceDeploymentStatement(envelope, {
  publicKey,
  request: { method: "GET", url: "https://edge.example/data?asset=ETH" },
  runtimeOffer: {
    protocol: "x402",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    recipient: "0x2222222222222222222222222222222222222222",
    decimals: 6,
  },
});
```

Verification fails closed on a lookalike or unlisted origin, a different HTTP
method or path, an expired statement, a different verification key, and any
protocol, network, asset, recipient, or decimals mismatch. The result excludes
query values and explicitly reports that it did not authorize, sign, or send a
payment. The caller must obtain the verification key through a separate trusted
identity channel. A valid signature proves control of that key, not DNS or
domain control.

Private-key signing is intentionally library-only. The CLI can verify an
envelope without accepting private keys:

```bash
agent-payment-policy service-deployment-verify envelope.json public-key.pem observation.json
agent-payment-policy service-deployment-schema
```

Version 0.10.0 adds a credential-free response-contract readiness boundary for
machine buyers. It classifies one seller-declared successful JSON response as
`admissible`, `partial`, `absent`, or `invalid` before value authorization:

```bash
agent-payment-policy response-contract-check response-observation.json
agent-payment-policy response-contract-schema
```

An admissible declaration is a bounded, self-contained top-level object schema
with typed required fields and no unsupported composition or external-reference
keywords. An optional example is checked only for structural consistency with
that limited subset. The report retains the schema digest and top-level
required field names, but not the schema, example, or query values. It makes no
network request and accesses no credential or wallet.

This is pre-purchase evidence, not runtime attestation. Seller declarations are
unauthenticated unless the integrating caller supplies a separate trust layer.
The paid response must still be validated against the independently authorized
output contract after settlement. Complex JSON Schema composition remains
`partial` instead of receiving invented coverage.
