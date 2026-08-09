# Contributing

Start with a failing test that names the security property or interoperability
gap. Keep the core independent from wallets, private keys, facilitators, hosted
services, and project-specific identities.

Before opening a change:

```bash
npm ci --ignore-scripts
npm test
npm audit --omit=dev
npm pack --dry-run
```

Changes that add network access, persistent storage, wallet execution, payment
signing, redirects, or DNS resolution require a separate threat-model section
and integration review.
