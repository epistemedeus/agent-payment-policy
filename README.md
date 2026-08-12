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

## Try it

```bash
npm install agent-payment-policy
npx agent-payment-policy demo
npx agent-payment-policy inspect-url 'https://example.com/data?asset=ETH'
npx agent-payment-policy inspect-json-request 'https://example.com/analyze' ./request.json
```

The demo generates an ephemeral policy key and produces a plan plus a verified
authorization. It performs no network request and no payment.

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

## Status

This is a reference implementation under active design review. It does not
claim adoption, adaptive supplier selection, wallet security, or transaction
execution. A separately reviewed adapter can use the verified authorization as
one input to its own signing policy. A control-coverage report does not make a
provider trustworthy by declaration; the integration remains responsible for
proving every claimed enforcement path.
