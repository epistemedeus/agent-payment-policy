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
npm run test:dual-era
npm run test:era-wire
npm run test:runtime
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
for modern and legacy useful, refusal, recovery, cancellation, timeout,
era-pinning, wire-buffer close/restart and in-flight disconnect calls.
Pass `--unsupported-node /absolute/checked/node20` to also verify engine refusal
from packed bytes; without it that one engine check is explicitly unrun.
It never falls back to a public package name. The optional `--keep-scratch` retains only its new consumer for a
subsequent disposable native configuration; the caller must remove that scratch.
An exact pinned publisher binary may be passed to `scripts/validate-release.mjs`
for structural validation. Structural validity does not prove namespace control.

For cold canonical native receiving, prerequisites are an **existing** official
Codex CLI 0.163.0, an owned canonical Node >=22 executable, Linux x86_64 and the
read-only v2 producer closure at Pilot
`23bb53fb8806ea3d84514914a307b7a3557a2088`, directory
`tools/ops/native-sol-mcp-profile` (including `test_stdio_native.py`,
`probe_ownership.py` and `no_network.py`). Do not install a CLI or import auth to
satisfy missing prerequisites. In the same evidence directory, run:

```sh
MCP_EVIDENCE_DIR=/absolute/disposable/receipts \
  python3 scripts/cold-receive.py /absolute/candidate.tgz --keep-scratch
MCP_EVIDENCE_DIR=/absolute/disposable/receipts \
  python3 scripts/native-receive.py /absolute/candidate.tgz \
  --cold-receipt /absolute/disposable/receipts/cold-receipt.json \
  --profile-source /absolute/read-only/pilot/tools/ops/native-sol-mcp-profile \
  --native-cli /absolute/existing/official/codex \
  --node /absolute/owned/canonical/node
```

The native receiver rechecks that exact archive, every shipped file and the
acquired runtime tree, then uses the unchanged producer to bind the actual packed
entry/cwd/hash and four enabled tools. It owns a new empty HOME/CODEX_HOME,
denies Internet sockets in native descendants, initializes the app-server,
creates only ephemeral threads and calls the four tools with independent stock
and receipt expectations. It also receives bounded/redacted refusals, a reduced
allowlist, source-hash mismatch, startup timeout/recovery and fresh-process
restart. The source checkout must retain product base `a6fb83f3abfa5c028b2356fa9665e24212505727`:
the receiver reads its original files into disposable scratch for a separately
labeled modern-only negative control. That original refusal witnesses the actual
native requested revision; candidate peer-info diagnostics independently witness
the successful negotiated revision. Historical receipts are not rewritten.
`turn/start` is absent. Configuration's model field does not execute a
model. Remove the retained cold scratch named in `cold-receipt.json` after use.

ROOT3033 records executed no-turn policy receiving; ROOT2981's older native
refusal remains an immutable historical observation of modern-only scope.
Missing native prerequisites are an unavailable receiving boundary. Actual
model-mediated use, installed profile selection and publication are future,
separately admitted cases owned by Root.

Only the release owner may publish the hash-checked tarball after receiving
presentation and authority. They must then read back exact npm distribution
metadata, reacquire those public bytes, repeat cold receiving using the exact
published version, and separately publish/read back the registry row. No tag,
default-branch change, npm or registry effect is part of this feature.

Retire the private feature or decline to merge for reversible rollback.
