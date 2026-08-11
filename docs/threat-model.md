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
- A compromised executor that attempts to spend beyond one signed plan.
- A delegated signer whose native policy cannot represent the selected chain,
  token, method, or protocol lifecycle.
- A coverage report that claims a stronger disposition than its underlying
  provider-native and independent evidence supports.
- A response that is oversized, malformed, or missing required fields.

## Out of scope

- Wallet key storage, payment signing, broadcast, custody, and chain finality.
- DNS rebinding or redirect safety unless the integrating network adapter uses
  the exported address checks and pins the validated destination.
- Economic truth of caller-supplied expected value or risk reserve.
- Correctness of an external x402 or MPP challenge parser.

## Fail-closed integration requirements

An executor must independently match the live challenge to the verified plan,
reconstruct and match any canonical JSON request body,
resolve and pin public IP addresses, reject cross-origin redirects, cap time and
bytes, enforce idempotency, and reconcile the actual amount before recording a
successful receipt. For a delegated signer, define a code-backed control profile,
verify the provider-native and independent enforcement paths separately, call
`assertControlCoverage` before any account or signer access, and fail closed when
one required control is uncovered.
