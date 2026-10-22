# Optional package release candidate

This directory owns `@epistemedeus/agent-payment-policy-mcp@0.1.0`, binary
`agent-payment-policy-mcp`, MCP name
`io.github.epistemedeus/agent-payment-policy-mcp`. It is independently packable;
the default root package and its release workflow do not include this integration.

Before release, review the documentation and names, receive the exact feature
commit/tree and archive hash from the external receipt, and verify npm package
control and registry namespace authority separately. No public package or registry
listing is asserted by this source.

From this directory, with Node >=22 and Python 3 on Linux:

```sh
npm ci --ignore-scripts --engine-strict
npm run baseline
npm test
npm run test:variant
npm run test:wire
MCP_EVIDENCE_DIR=/absolute/disposable/receipts npm run check:release
mkdir -p artifacts
npm pack --ignore-scripts --pack-destination artifacts
MCP_EVIDENCE_DIR=/absolute/disposable/receipts \
  python3 scripts/check-pack.py artifacts/epistemedeus-agent-payment-policy-mcp-0.1.0.tgz
MCP_EVIDENCE_DIR=/absolute/disposable/receipts \
  python3 scripts/cold-receive.py artifacts/epistemedeus-agent-payment-policy-mcp-0.1.0.tgz
```

The cold receiver uses a new npm cache and official SDK client, verifies every
packed file and all ten runtime dependency trees, then denies network syscalls
for useful, refusal, recovery and wire calls. It never falls back to a public
package name. The optional `--keep-scratch` retains only its new consumer for a
subsequent disposable native configuration; the caller must remove that scratch.
An exact pinned publisher binary may be passed to `scripts/validate-release.mjs`
for structural validation. Structural validity does not prove namespace control.

Only the release owner may publish the hash-checked tarball after receiving
presentation and authority. They must then read back exact npm distribution
metadata, reacquire those public bytes, repeat cold receiving using the exact
published version, and separately publish/read back the registry row. No tag,
default-branch change, npm or registry effect is part of this feature.

Retire the private feature or decline to merge for reversible rollback.
