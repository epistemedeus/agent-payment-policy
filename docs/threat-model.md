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
