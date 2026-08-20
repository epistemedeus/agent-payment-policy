# Contributing

Start with a failing test that names the security property or interoperability
gap. Keep the core independent from wallets, private keys, facilitators, hosted
services, and project-specific identities.

Before opening a change:

```bash
npm ci --ignore-scripts
npm test
npm run examples
npm audit --omit=dev
npm pack --dry-run
```

`npm test` includes a clean packed-package consumer run of the adoption
examples. Those examples must stay credential-free: no `authorizePlan`, wallet
access, network client, or payment send on the default path.

Changes that add network access, persistent storage, wallet execution, payment
signing, redirects, or DNS resolution require a separate threat-model section
and integration review.
