# Adoption examples

These scripts are the smallest local adoption path. They use caller-supplied
mock x402 and MPP offers plus a frozen policy-authorization fixture. The
examples do not fetch, load a wallet, accept credentials, sign a payment, or
send a payment.

The first two examples ship starting in 0.15.0. The paid-response example
ships starting in 0.15.2. From a new project:

```bash
npm install --save-exact agent-payment-policy@0.15.2
node node_modules/agent-payment-policy/examples/mock-x402-mpp-preflight.mjs
node node_modules/agent-payment-policy/examples/verify-policy-receipt.mjs
node node_modules/agent-payment-policy/examples/x402-paid-402-evidence.mjs
```

`mock-x402-mpp-preflight.mjs` compares catalog and runtime offers, checks listing
identity, a seller response contract, purchase evidence, and a buyer output
schema, then selects one policy-compliant plan. Catalog and runtime are the same
mock object, and the purchase-evidence manifest is caller-built, so a `verified`
status is seller-declared consistency, not an independently fetched seller
document. It stops before policy authorization.

`verify-policy-receipt.mjs` reconstructs that kind of plan, verifies a committed
Ed25519 policy authorization fixture, binds a public-safe receipt, and
classifies receipt completeness from synthetic caller-supplied observations.
The completeness report is a fixture classifier. It is not chain, wallet, or
facilitator evidence. It does not generate keys.

`x402-paid-402-evidence.mjs` compares nine synthetic cases. It separates
offer and settlement observations, shows a conflict tied to the same
dispatch, and preserves a valid distinct repeat. It makes no settlement
lookup and gives no retry authorization.

The CLI `demo` command is a separate ephemeral policy-signing walkthrough. It is
not the default command and is not required to run these examples.
