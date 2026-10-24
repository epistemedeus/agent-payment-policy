# ROOT5180 handback

**Verdict: precisely observed unresolved npm/SDK process-ownership boundary.**
The unchanged frozen archive completes ordinary EOF, closed input/output pipes,
and bounded request cancellation. It is not qualified for arbitrary signal-only
client cancellation. No Policy bin/runtime repair is justified by these results:
the demonstrated residuals belong to npm/SDK launcher ownership, outside the
server's observable transport lifecycle. No monitor or replacement wrapper was added.

Product base: `1885e4a842ceacc5bf86d096428ed1894c49c1c6`.
Separate staged Pilot operating/assignment source:
`58f83710ebcbd5de140fb8a618e4d00ac9dd8bdf`.
Writer: `codex/root5180-policy-client-cancellation-20261024`.
Configured origin: `https://github.com/epistemedeus/agent-payment-policy.git`.
Frozen acquisition:
`https://raw.githubusercontent.com/epistemedeus/agent-payment-policy/239682a8c3429d807b4ad4ce712af8d15268b354/integrations/mcp/qualification/ROOT3033/candidate.tgz`.
Received 18,633 bytes, SHA256
`f45615114494fc7167234743d5a2ff4cda54d20e07de72c49c9e42e6b629c439`.
Node v22.23.4, npm 10.9.9, official MCP client/server/core 2.3.1, Linux only.

The exact current README launch command was received unchanged:

```sh
npm exec --yes --ignore-scripts --no-audit --no-fund --engine-strict \
  --package=https://raw.githubusercontent.com/epistemedeus/agent-payment-policy/239682a8c3429d807b4ad4ce712af8d15268b354/integrations/mcp/qualification/ROOT3033/candidate.tgz \
  -- agent-payment-policy-mcp
```

The first run executes that literal block via `sh -eu -c`; the decisive second
run passes its exact argv directly to npm, as an MCP client normally does.
Both start with empty private short-path HOME/default cache and consumer.
[Closure](ACQUISITION.json) independently compares all 15 archived files and
all ten runtime dependency trees against the existing frozen inventory. No
archive, bin, runtime, core, lock, version, release or acquisition URL changed.

| Actual case | Outcome before harness containment |
| --- | --- |
| Cold acquisition, initialize, useful calls, EOF | Exit 0; npm/shell/server gone naturally |
| Initialized client closes both input/output | Exit 0; every captured descendant gone |
| Launching Python client receives SIGTERM after initialization | Client -15; server and shell terminate on pipe closure; npm becomes an orphan zombie |
| Client SIGTERM 20 ms into startup | Client -15; npm can still start its shell/server after client death, then EOF completes; npm zombie remains |
| Outstanding bounded request, both pipes closed | Exit 0; worker/server/launcher finish before 1,500 ms work deadline |
| Outstanding bounded request, client SIGTERM | Client -15; no live descendant at bounded observation; npm zombie remains |
| SIGTERM only to npm, client retains pipes | npm -15; same server still alive at 0.5, 3.5 and 6 seconds; answers the same useful MCP call after npm termination |
| Official SDK legacy, bare npm | Useful/refusal/recovery, request abort and close pass; no surviving captured process |
| Official SDK modern, bare npm | Functional cases pass; disposable negotiation probe leaves one orphan zombie server per session (three observed) |

[Raw cases](ARCHIVE-CASES.json) contain 13 serial sessions, including a fresh
useful/refusal/negative-decision restart immediately after each decisive case.
They reuse ROOT3124's frozen packing binding, accepted 48-unit response,
wrong-type `{valid:false}`, and redacted credential-shaped `POLICY_REFUSAL`.
The existing `^(a+)+$` worker fixture makes outstanding work technically meaningful;
this is the existing bounded synchronous worker, not a manufactured async service.
[SDK cases](SDK-CASES.json) contain six bare-npm sessions: close, pending-close,
and fresh recovery in each era. Request abort plus useful recovery takes less
than 1,000 ms; pending close also finishes in less than 1,000 ms. Modern and
legacy useful/refusal results remain distinct from lifecycle completion.

[Npm-only boundary](NPM-SIGNAL-BOUNDARY.json) proves that npm's death is not
server cancellation when the client's pipe endpoints remain open. The test client
subsequently exits, releasing its descriptors; only then does the server finish.
That release is containment of this negative case, not a repaired acquisition.
[SDK process evidence](SDK-PROCESSES.json) identifies the three modern probe
zombies. The SDK's `_dispose()` ends stdin and immediately terminates its npm
child; its ordinary `close()` ends stdin and first awaits natural completion.
The adapter already closes its transport/stops workers on EOF and signals. It
cannot reap npm/its own parent or infer cancellation from still-open pipes.
Fixing the third-party probe/launcher owner, or requiring a client to close its
transports and reap its child, remains outside this bounded product change.

Every probe's receiver is a Linux subreaper **for observation and containment**.
It sends no cleanup signal before recording the bounded result. All final
containment signal lists are empty: only already-dead adopted children needed
`waitpid`. Zombie reaping is explicitly separate from unassisted command results.
PID/start ticks, original parent, group, cwd and argv are retained for captured
task descendants only. No system-wide process scan or unrelated signal occurred.
Sampling is 10/20 ms, not an exhaustive trace or memory enforcement.

[First observations](FIRST-OBSERVATIONS.json) and [original probe](first-probe.py)
are preserved. Their `npm-term` label actually targeted the outer `sh` PID;
those observations are not used as proof of direct npm termination. The later
bare-argv run and supplemental npm-only probe correct that harness ambiguity.
The first shell-form client-death zombie is the outer shell, not npm.
ROOT3124 and its historical helper-assisted SDK conclusions remain unchanged.

Reproduction, serially from the repository root (Node heap 256 MiB):

```sh
python3 integrations/mcp/qualification/ROOT5180/probe.py
python3 integrations/mcp/qualification/ROOT5180/sdk-run.py
python3 integrations/mcp/qualification/ROOT5180/npm-boundary.py
```

`probe.py` writes its new scratch pointer and exact archive/raw receipts;
`sdk-run.py` needs the owning optional package's locked dev dependencies installed.
The SDK run adds `--offline` to the received npm argv and inherits the existing
`no-egress.py` guard. No special npm descendant wrapper is used by these clients.
A rerun should retain its evidence separately rather than replacing this run.

[Checks](CHECKS.json): existing `tests/runtime-controls.mjs`, pointed at the
actually acquired immutable bin under `no-egress.py`, passes oversize-wire
closure, fresh useful recovery and in-flight disconnect. Local release structural
validation passes all 19 cases. Its first invocation failed because this worker
omitted required `MCP_EVIDENCE_DIR`; that invocation and the corrected success
are both retained. No publisher CLI was invoked. All four Python probes parse.
The optional dependency setup command was
`NODE_OPTIONS=--max-old-space-size=256 npm_config_ignore_scripts=true npm ci --ignore-scripts --no-audit --no-fund --engine-strict --prefix integrations/mcp --cache /tmp/r5180-check-cache`.
That setup inherited controller npm configuration; the acquisition/runtime probes
explicitly isolate HOME and npm configuration. No account/secret store was
explicitly accessed or copied, and no credential output was collected.

Self-review confirms the only product diff is this README qualification pointer
and its scoped lifecycle facts; executable product sources, money rules and all
locks remain byte-identical to base. New files are confined to ROOT5180 evidence.
The declared total reserve is 2,097,152 KiB including descendants, with zero model
children. Receipts measure only task receiver/test descendants; they do not claim
to independently measure the native model/controller allocation. Root separately
receives actual admission and final native termination. All processes are serial;
worker limits remain 64 MiB and Node hosts use 256 MiB heaps.

[Cleanup](CLEANUP.json) records removed task scratch/dependencies and absent
captured identities. No installed repair, registry publication, release, account,
spend, provider inference, public contact or all-client/all-OS qualification is
claimed. Root receives the private branch export and decides any follow-on at
the exact npm/SDK boundary. Canonical job-root `WORKER-EXPORT.json` binds final
commit/tree/push readback without a self-referential committed hash.
