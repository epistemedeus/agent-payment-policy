# Adoption examples

These two scripts are the smallest local adoption path. They use caller-supplied
mock x402 and MPP offers plus a frozen policy-authorization fixture. They do not
fetch, load a wallet, accept credentials, sign a payment, or send a payment.

Versions before 0.15.0, including 0.14.1, do not include `examples/`. Version
0.15.0 includes them. To test the exact source tree before installation, pack
this repository:

```bash
npm pack --ignore-scripts
npm install ./agent-payment-policy-0.15.0.tgz
node node_modules/agent-payment-policy/examples/mock-x402-mpp-preflight.mjs
node node_modules/agent-payment-policy/examples/verify-policy-receipt.mjs
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

The CLI `demo` command is a separate ephemeral policy-signing walkthrough. It is
not the default command and is not required to run these examples.
