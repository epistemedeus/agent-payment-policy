# Optional package release candidate

This directory owns `@epistemedeus/agent-payment-policy-mcp@0.1.0`, binary
`agent-payment-policy-mcp`, MCP name
`io.github.epistemedeus/agent-payment-policy-mcp`. It is independently packable;
the default root package does not include this integration. The existing root
`publish.yml` runs root `npm publish` on **every published GitHub Release**.
Keep it unchanged and never create an optional GitHub Release for this package.

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

Retire the private feature or decline to merge for reversible rollback.

## Manual optional npm release

`optional-mcp-release.yml` is a separate `workflow_dispatch` route with a
`prepare` default. Preparation has only `contents: read`; only the separately
selected `publish` job gets `id-token: write`. Choose a reviewed workflow ref and
supply its exact full commit SHA as `source`, plus `version=0.1.0`. Checkout HEAD
must equal that SHA and be clean. Inputs pass through environment variables and
quoted arguments. Do not dispatch the workflow during source qualification.

The helper can prepare locally from `integrations/mcp` on a clean checkout with
Node >=22 and Python 3. Output must be a new directory outside the checkout.
Packing needs no dependency installation:

```sh
NODE_OPTIONS=--max-old-space-size=256 python3 scripts/npm-release.py prepare \
  --source FULL_REVIEWED_COMMIT_SHA --version 0.1.0 \
  --output /absolute/new/optional-mcp-release
NODE_OPTIONS=--max-old-space-size=256 python3 tests/npm-release.py
```

Preparation runs official `npm pack --ignore-scripts` and the existing exact
15-file `check-pack.py`, checks npm/server/source identities and shrinkwrap,
and writes `release.json` with commit/tree, bytes, SHA256 and SHA512 integrity.
The workflow installs with scripts disabled and runs serial baseline,
useful/refusal/recovery/restart and dual-era checks before uploading the archive
and receipts. The helper regression uses a real pack and an intercepted local
npm publish boundary. Its failure and explicit recovery have no public effect
and do not establish hosted OIDC acceptance.

Root owns initial publication using the **existing npm account**, its package
write authority, supported authentication and account 2FA. The optional package
must already exist before its own trusted publisher can be configured. Core's
trust does not enroll this package. This source neither publishes nor performs
`npm trust`, changes MFA, reads account stores, adds secrets or restores bypass
tokens. [Official trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites)
and [trusted publishing](https://docs.npmjs.com/trusted-publishers/) own current
requirements. Enroll the optional identity separately: owner `epistemedeus`,
repository `agent-payment-policy`, workflow filename `optional-mcp-release.yml`,
no environment name, with direct `npm publish` explicitly allowed. New trust
configurations must complete their first successful publish within two days.
Do not republish existing 0.1.0 after initial publication; this immutable version
is not an OIDC canary. A future version needs a separately reviewed identity
change and artifact receiving.

After enrollment, a separate Root-selected `action=publish` requires SHA256
from an earlier reviewed preparation of the same source. The publish job downloads
its run's preparation artifact, rechecks source/tree, shipped bytes and hash,
and makes one official `npm publish ARCHIVE --access public --provenance
--ignore-scripts` attempt. It requires GitHub-hosted manual Actions, this workflow,
OIDC variables and npm >=11.5.1 (workflow uses Node24). HOME/config/cache and publish
cwd are isolated; inherited npm tokens and config are excluded. Missing OIDC,
unconfigured authority or npm refusal stops without token fallback or internal
retry. Local tests do not establish a hosted OIDC exchange. No GitHub Release or
tag is needed or created.

## Cold npm name/version receiving

After Root has actually published, receive the exact public npm name/version
against the reviewed archive with a new external evidence directory:

```sh
NODE_OPTIONS=--max-old-space-size=256 python3 scripts/npm-receive.py \
  /absolute/reviewed/epistemedeus-agent-payment-policy-mcp-0.1.0.tgz \
  --evidence /absolute/new/npm-name-receipts
```

This receiver uses empty HOME/config/cache, scripts disabled and the official
registry. It reads exact name/version metadata, packs that exact npm name/version,
verifies registry SHA512 integrity and equality to the reviewed archive SHA256,
and records signatures/attestation metadata where available. The existing cold
receiver's public mode verifies registry signatures and available provenance with
official `npm audit signatures`, compares all shipped bytes and ten locked runtime
trees, and runs its useful/refusal/recovery/restart SDK suite through the existing
npm descendant reaper under no-egress. `--focused` omits the already qualified
variant/wire/full lifecycle matrix; their earlier evidence and limits remain.
Available provenance must verify; absent provenance is recorded as absent.
A metadata/pack 404 or failed check stops and preserves `npm-receipt.json` and
command logs. There is no HTTPS/source/archive acquisition fallback. An actual
npm404 leaves public acquisition and SDK receiving unrun even if private artifact
tests pass. Arbitrary bare-npm client disconnect cleanup remains unqualified.

Source export does not establish npm publication, Registry listing, native/model
selection, outside usefulness or revenue. Root owns actual public acquisition and
any Registry publication/readback separately. No account/public effect is part of
source qualification.
