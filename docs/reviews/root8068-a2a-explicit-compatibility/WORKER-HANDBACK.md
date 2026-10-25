# Root8068 source-only handback

**Native SDK route received and tested.** The existing optional example now has
an explicit `--legacy-0.3` / `startServer({ legacyCompat: true })` option. Default
1.0 behavior remains equal to the frozen original. No hosted use, provider repair,
adoption or revenue is established. Root owns independent receiving and any PR.

Product base: `ad2065914251e1f807ab6c226a9bdb3dd631dd7b`, tree
`cd3527faef7f02957d7c4fd7ba3a37b012639f01`. Writer remains
`codex/root8068-a2a-explicit-compatibility-20261025`. Final commit/tree and remote
readback are bound in the same owner's `outputs/COMMIT-PUSH.json`; this handback
is included in that commit. Operating/assignment source is separately frozen at
Pilot `4ef534cf4e778eabc0371f22874e02231e308368`.

Changed scope: optional `server.mjs`, `client.mjs`, `README.md`, new
`compatibility.test.mjs`, and this handback only. Core/API, normalization/payment
semantics, both package files/locks, CI and all other examples remain unchanged.

## Source and execution boundary

All eleven exact product blobs, receipt SHA-256 and four operating members were
verified and read before compatibility inference. The immutable original
[result](https://github.com/epistemedeus/pilot/blob/a374d9e9bafb3d7955ebad5756d8e72e7b344226/overview/research/phase-20261025/a2acloud-hosted-first-use/RESULT.md),
[adjudication](https://github.com/epistemedeus/pilot/blob/9fe5a0c9ce7f166ce74793a90fd1f4611f49f6d8/overview/research/phase-20261025/a2acloud-hosted-first-use/ROOT-ADJUDICATION.md)
and reduced wire were received through their supplied URLs. Their four failed
headerless `message/send` calls, direct controls, zero observed charge changes and
cleanup are preserved. New payloads use the official 0.3 schema and are synthetic.

The received SDK is the unchanged lock's **@a2a-js/sdk 1.3.0**, official
[29417a5b source](https://github.com/a2aproject/a2a-js/tree/29417a5bb4038f804f310ce4fffd267a9375aa90),
[Apache-2.0 license](https://github.com/a2aproject/a2a-js/blob/29417a5bb4038f804f310ce4fffd267a9375aa90/LICENSE).
Its [published compatibility contract](https://github.com/a2aproject/a2a-js/blob/29417a5bb4038f804f310ce4fffd267a9375aa90/src/compat/v0_3/README.md)
exposes `LegacyJsonRpcTransportHandler`, `duplicateInterfacesForLegacy`, and
`JsonRpcTransportFactory({ legacyCompat: { enabled: true } })`. Declared support
is corroborated by real exchanges, not inferred from accepted syntax or a card.
No new SDK/framework, private translator import, copied codec or dependency change.

Opt-in advertises 1.0 and 0.3 JSONRPC only. Exact SDK version validation precedes
dispatch; known method names must agree with the selected header. Header omission
means 0.3 only on the opted-in server. Before the SDK can discard ambiguous fields,
legacy envelope checks refuse extra/ambiguous parts, text/files/URLs, primitive
unwrapping metadata, nonblocking/push, references and malformed configuration.
The official native decoded request then passes the shared skill/data/size/depth
validator before execution. A native 0.3 JSON DataPart has no media-type field;
its decoded empty media type is admitted only on that guarded legacy route.
History is forced to zero; terminal tasks are discarded. Targets are never fetched.

Discovery deliberately remains the existing **1.0-shaped card**. A caller that
requires 0.3-shaped card discovery is outside this invocation proof. Both SDK
clients execute; the legacy SDK client has no `tasks/list` operation, recorded as
unsupported. A supplied legacy configuration requires `blocking: true`; absent
configuration uses synchronous processing. Client selection copies interfaces
for the explicit call without changing the discovered card or saved settings.

## Actual remote verification

Node 22.23.4 / npm 10.9.9 on the admitted Cursor VM. Native rollout receives the
same session `01a17378-90a6-79d0-88ca-122669e72af5`, model `gpt-6.1-sol`, effort
`high`; one parent, zero model children. All commands used Node heap 512 MiB,
UV=1, OMP=1, serial tests within the 2 GiB reservation (not a claimed kernel cap).

| Command/control | Result |
| --- | --- |
| Root and optional `npm ci --ignore-scripts` | Both exit 0; locks unchanged |
| Original `node --test --test-concurrency=1 …/normalization.test.mjs` | 55/55, exit 0 |
| Original root `node --test --test-concurrency=1 *.test.mjs` | 75/75, exit 0 |
| Final optional `npm test` | 132/132 = original 55 + new 77, exit 0 |
| Final root `npm test` | 75/75, exit 0 |
| `npm audit --omit=dev` | Exit 0, zero reported vulnerabilities |
| `npm pack --dry-run` | Exit 0, prepack's 75 tests serial and passing |
| `npm sbom --sbom-format cyclonedx` | Exit 0, nonempty output |
| Frozen-original live default comparison | Complete cards/headers, 20 SDK cases and 32 invalid/boundary cases equal for omitted and explicit-false opt-in |
| Full loopback receiving | GET/query, exact core refusal, POST/body recovery: 6 SDK outputs plus 3 headerless legacy outputs equal the complete direct envelopes |

No skips/cancellations. The root npm scripts use an output-local PATH wrapper
that adds `--test-concurrency=1` to actual Node argv, including nested prepack;
it is never put in NODE_OPTIONS. Command times/exits and cumulative child maximum
RSS (129584 KiB, not whole-job aggregate RSS) are in `final-commands.json`.
Default comparison normalizes only generated IDs, ephemeral ports and HTTP dates.
New cases cover version/header disagreement, unknown versions, Host/Origin/paths,
wire/data/depth limits, legacy validation/recovery, task isolation, overlap/429,
close/rebind/restart, and DNS/fetch/file/signing traps with a zero-hit sentinel.

First focused run is preserved: 63/71 passed, eight failures, exit 1. Six exposed
custom validation errors becoming SDK internal errors; the guarded native route
now throws SDK `RequestMalformedError`, preserving invalid-params. Two were test
harness defects: fetch did not send the hostile Host, and cleanup closed a server
twice. Corrected second suite passed 126/126; added codec-omission/metadata cases
passed 132/132. The final helper's first invocation failed before tests because
GNU time was absent; its script/empty logs/failure receipt remain, and Python
child-usage measurement replaced that assumption. One required agent-status
read returned missing browser/session health helpers; no such unrelated service
was started or changed.

## Admission, evidence and next consumer

Root8080 preparation hashes join the original canonical RUN/current OWN-ADMISSION
to the same writer/session, 2097152 KiB reservation and original requiredUntil
**15:29:41.465 UTC**. Original stage receipt: 14:30:07.353; original launch:
14:30:43.353; one-shot resume: 14:43:05.032. Checkpoint file was written
14:53:21.842, **17.185 seconds after** checkpointBy 14:53:04.657; the commentary
had already reported progress. No guard, foreground lifetime, claim, kernel,
producer or other job was changed. Prior failed run/events remain intact; no
automatic capacity retry, account action, credits or reset occurred.

Owned raw evidence root:
`/home/ubuntu/root-sol-window100337/root8068-a2a-explicit-compatibility-20261025/outputs/`.
Start with `RESULT.json`, `final-commands.json`, `native-identity.json`,
`admission-verification.json`, `official-sdk-source.json`,
`default-preservation.json`, `loopback-evidence.json` and `self-review.json`.
All task-created loopback listeners and verification children are closed/reaped.
Canonical kernel retains claim/termination/normal collection ownership.

Root's next complete hosted test requires fresh same-account entitlement and
zero-cash cost controls, then an independently qualified private opt-in instance.
Receive the imported card and actual intermediary method/header/body shape,
including any legacy-shaped discovery limitation. Compare complete GET, exact
core refusal and POST recovery artifacts with direct SDK/core controls before
and after; receive successful-call economics separately. Preserve unknowns and
7830's original failures, then use supported removal/readback and scoped origin/
tunnel cleanup. No account/login/token/import/tunnel, hosted call, provider
contact, deploy, payment, service/package publication or PR was performed by this
source task. The source branch push is the explicitly authorized export.
