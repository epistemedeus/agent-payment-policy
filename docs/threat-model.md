# Threat model

## Protected decisions

- The machine need, full request query, and JSON POST body remain private.
- A seller cannot replace the method, URL, canonical JSON POST body, amount,
  recipient, network, asset, or expiry after planning.
- A payment executor cannot treat a broad budget as approval for a different
  purchase.
- Public receipts do not contain response bodies or query values.

## Named adversaries

- A registry with stale or misleading offer metadata.
- A seller that changes economics between discovery and execution.
- A caller that supplies a private-network URL or credential-bearing query.
- A caller or executor that substitutes a JSON body after authorization.
- A caller or signer bridge that adds, removes, reorders, or modifies a call in
  a reviewed batched signing action.
- A compromised executor that attempts to spend beyond one signed plan.
- A delegated signer whose native policy cannot represent the selected chain,
  token, method, or protocol lifecycle.
- A coverage report that claims a stronger disposition than its underlying
  provider-native and independent evidence supports.
- A response that is oversized, malformed, or missing required fields.
- A response that contains every required path but substitutes the wrong JSON
  types or invalid formatted strings after payment.
- A cumulative policy whose metric silently decodes an unrecognized action as
  zero, whose successful signatures race before counter updates, or whose
  signed-but-unbroadcast activity diverges from on-chain settlement.
- A catalog that omits economic terms and is incorrectly treated as agreeing
  with the complete live unsigned offer.
- A copied well-known file or duplicate catalog record that claims an
  unauthorized deployment origin, route, or settlement identity.
- An authorized alias that is permitted for one route or rail and is
  accidentally granted a different deployment binding through a cross-product
  policy.
- A seller that publishes payment inputs and price but no machine-verifiable
  success-response contract, causing a buyer to pay for output it cannot judge.
- A response example that contradicts its own declared response schema.
- A generic `describedby` link that points to unrelated API documentation and
  is incorrectly fetched as purchase evidence.
- A seller manifest that changes effect, output guarantees, replay terms, or
  receipt expectations after buyer authorization while price stays constant.
- A provider receipt that proves success or a transaction reference but omits
  an accounting field, and an integrator that either invents the missing fact
  or treats the whole settlement as unverified.

## Out of scope

- Wallet key storage, payment signing, broadcast, custody, and chain finality.
- DNS rebinding or redirect safety unless the integrating network adapter uses
  the exported address checks and pins the validated destination.
- Economic truth of caller-supplied expected value or risk reserve.
- Correctness of an external x402 or MPP challenge parser.
- The authority of a service-deployment verification key. The integrating
  buyer must obtain the public key from a separate trusted identity channel.
- DNS or domain control. A valid service-deployment statement proves control of
  the supplied Ed25519 key, not control of a hostname.
- Semantic safety of the original unsigned action. Exact execution binding
  prevents mutation after review; it does not make an unsafe original safe.
- Live x402 or MPP clients. The shipped adoption examples compare
  caller-supplied mock offers and verify a frozen policy authorization
  fixture. They are not a network adapter, wallet, or payment executor.

## Adoption examples

`examples/mock-x402-mpp-preflight.mjs` and
`examples/verify-policy-receipt.mjs` must fail closed as documentation of the
library boundary:

- no DNS, sockets, HTTP client, or `fetch`;
- no wallet, credential, or environment-key load;
- no `authorizePlan`, `authorizeExecution`, or `signServiceDeploymentStatement`;
- no payment signature or broadcast;
- mock catalog and runtime offers may be the same object, and purchase-evidence
  manifests may be caller-built, but reports must not present those as
  independently fetched seller documents;
- receipt completeness observations in the verify example are a synthetic
  fixture. Printed reports must retain `evidenceBoundary` and must not be
  copied as production chain, wallet, or facilitator evidence.

`npm test` (and therefore GitHub Actions `verify` on pull requests and pushes
to `main`) runs both examples, asserts the CLI default path only prints usage,
and installs the packed tarball in a temporary consumer, including the
in-package README path. Feature-branch pushes do not trigger that workflow
until a pull request exists. A later executor remains responsible for live
challenge matching, DNS/SSRF controls, and settlement.

## Fail-closed integration requirements

An executor must independently match the live challenge to the verified plan,
reconstruct and match any canonical JSON request body,
resolve and pin public IP addresses, reject cross-origin redirects, cap time and
bytes, enforce idempotency, and reconcile the actual amount before recording a
successful receipt. For a delegated signer, define a code-backed control profile,
verify the provider-native and independent enforcement paths separately, call
`assertControlCoverage` before any account or signer access, and fail closed when
one required control is uncovered.

When a signing action is built after the live challenge arrives, create a
short-lived execution authorization over the full canonical action and verify it
at the signer boundary. The action body remains private; the authorization and
optional receipt retain only its digest and byte count.

Before `createPlan`, normalize the catalog candidate and the live unsigned
offer through `evaluateOfferCoherence`. Treat `partial` as missing evidence and
`drifted` as a rejected or refresh-required candidate. Only `coherent` is
eligible for separate value and policy authorization. The evaluator does not
prove either source, so the adapter must still fetch the live challenge through
the DNS, redirect, timeout, and byte boundaries above. For x402, derive an
absolute runtime deadline from the observed challenge time and its bounded
relative timeout; never invent a long-lived expiry.

For a signed service-deployment statement, verify the JWS against a public key
obtained through a separately trusted identity anchor. Require an exact
deployment-origin entry, exact HTTP method and path, exact protocol, network,
asset, recipient, and decimals. Each origin carries its own route and
settlement lists so an alias does not inherit another origin's authority. Check
the short validity window at use time and then continue through the separate
live challenge, value, policy, authorization, and execution boundaries.

Treat `evaluateResponseContract` as seller-declared pre-purchase evidence only.
An `admissible` result means the limited self-contained schema subset can be
turned into an independently authorized output contract. It does not prove the
seller will return that shape. Validate the actual paid response separately and
record output failure without inventing a successful delivery.

When an intent includes `output.schemaDigest`, obtain the acceptance schema
through the buyer's trusted local policy channel, run `inspectOutputSchema`, and
prepare the matching validator before account, wallet, or signing access. Pass
that exact validator to `createReceipt`. Required-field checks alone do not
enforce types, formats, enums, numeric bounds, or additional-property policy.
The seller's response-schema digest may differ because a buyer can authorize a
narrower acceptance projection, but the buyer's digest must remain exact from
intent through receipt validation.

Purchase-evidence discovery requires both the generic `describedby` relation
and the package's exact extension relation. Ignore unrelated `describedby`
links. Require one same-origin manifest, enforce adapter-side time and byte
limits, verify the deterministic digest and exact method-path operation, bind
the resulting manifest and response-schema digests into authorization, and
refetch before wallet access. Seller-declared evidence can narrow a policy
decision but cannot authorize spend or replace live challenge, output, receipt,
or settlement verification.

Treat `evaluateReceiptCompleteness` as a classifier for already verified facts,
not a receipt parser or chain verifier. Map provider receipts, authoritative
transactions, and exact balance evidence to controlled states before calling
it. Preserve missing dimensions as null evidence, reject every mismatch, and
require the integrating buyer to establish payer, recipient, asset, network,
amount, finality, and output validity through its own trusted adapters. A
`reconciled` report proves only that the supplied normalized facts collectively
cover the settlement dimensions without conflict. It does not prove their
source, authorize payment, or establish demand.

## Wallet-policy observation evidence

The wallet-policy observation report is a classification of caller-supplied
test outcomes, not remote attestation. A dishonest or mistaken caller can label
a generic provider failure as a policy denial. Integrations should preserve the
underlying bounded test evidence separately and use this format to normalize
results, not to manufacture trust. Only explicit provider-policy denial earns
native coverage, and unrun cases remain partial. Exact execution shape requires
the separate duplicate-approved-action probe.

## Stateful wallet-policy observation evidence

The stateful report also classifies caller-supplied evidence. It distinguishes
provider-policy denial from an application queue or mutex, validation failure,
and generic provider failure. A passing sequential cap does not prove strict
concurrency safety, and a provider-native counter does not replace exact
function and calldata constraints. A production integration should combine a
per-request cap, exact action binding, application serialization, provider-
native aggregation where useful, and post-settlement reconciliation.
