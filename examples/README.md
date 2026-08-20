# Adoption examples

These two scripts are the smallest local adoption path. They use caller-supplied
mock x402 and MPP offers plus a frozen policy-authorization fixture. They do not
fetch, load a wallet, accept credentials, sign a payment, or send a payment.

From an install of this package:

```bash
npm install agent-payment-policy
node node_modules/agent-payment-policy/examples/mock-x402-mpp-preflight.mjs
node node_modules/agent-payment-policy/examples/verify-policy-receipt.mjs
```

`mock-x402-mpp-preflight.mjs` compares catalog and runtime offers, checks listing
identity, a seller response contract, purchase evidence, and a buyer output
schema, then selects one policy-compliant plan. It stops before policy
authorization.

`verify-policy-receipt.mjs` reconstructs that kind of plan, verifies a committed
Ed25519 policy authorization fixture, binds a public-safe receipt, and
classifies receipt completeness. It does not generate keys.

The CLI `demo` command is a separate ephemeral policy-signing walkthrough. It is
not the default command and is not required to run these examples.
