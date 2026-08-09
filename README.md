# agent-payment-policy

Credential-free policy and evidence primitives for machine buyers that use x402
or MPP.

This candidate package separates four concerns:

1. A private machine need becomes an immutable intent digest.
2. External offers are filtered by exact request, value, capital, ownership, and
   expiry constraints.
3. A separate Ed25519 policy identity authorizes one exact plan.
4. A public-safe receipt binds settlement and output evidence without retaining
   query values or response bodies.

It contains no wallet executor, payment signer, facilitator credential, seller
key, RPC key, live project identity, or default wallet path. It cannot move
funds.

## Try it

```bash
npm test
node cli.mjs demo
node cli.mjs inspect-url 'https://example.com/data?asset=ETH'
```

The demo generates an ephemeral policy key and produces a plan plus a verified
authorization. It performs no network request and no payment.

## Safety boundary

`normalizeRequest` rejects non-HTTPS URLs, user information, nonstandard HTTPS
ports, local hostnames, literal private/reserved IPs, and credential-like query
keys. A network adapter must resolve DNS and pass every result to
`assertResolvedPublicAddresses` immediately before connecting. It must also pin
the resolved address, reject cross-origin redirects, enforce time and response
size limits, and repeat the check after every allowed redirect.

The package hashes the full private request URL for exact binding while exposing
only method, origin, path, and query-key names in plans and receipts. See
[`docs/threat-model.md`](docs/threat-model.md) and
[`docs/data-handling.md`](docs/data-handling.md).

## Candidate status

This is a reference implementation under active design review. It does not
claim adoption, adaptive supplier selection, wallet security, or transaction
execution. A separately reviewed adapter can use the verified authorization as
one input to its own signing policy.
