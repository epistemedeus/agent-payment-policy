# Offline policy tools over MCP

This optional stdio adapter exposes four existing `agent-payment-policy@0.15.1`
computations through official MCP SDK 2.3.1. Requires Node.js 22 or newer.

| Tool | Supplied input and useful result |
| --- | --- |
| `normalize_request` | `{method,target,options?:{body?,mediaType?}}` → complete request/body binding; no target fetch or DNS check |
| `inspect_output_schema` | `{schema,requiredFields?}` → admissibility, exact schema digest and guaranteed paths |
| `accept_output` | `{schema,schemaDigest,output}` → exact CLI acceptance result, including useful `{valid:false}`; no body echo |
| `classify_receipt` | Controlled receipt/transaction/balance/output observations → independent completeness and delivery states |

Discover the full input/output schemas with `tools/list`. Receipt input is the
unchanged core `receiptCompletenessInputSchema()` shape. `reconciled`, `partial`,
`conflict`, `insufficient` classify supplied facts; `valid`, `invalid`, `unverified`
classify supplied output observations. They do not verify transactions,
signatures, balances or factual truth, authorize payment, or establish demand.

Official `serveStdio(factory, {legacy: 'serve'})` serves modern revision
`2026-07-28` and legacy initialization from the same four-tool factory. The SDK
negotiates and pins one era per connection. Modern discovery advertises modern
revisions only. Qualified callers include the official modern SDK client and
canonical Codex CLI 0.163.0 app-server's legacy `2025-06-18` consumer.

Arguments are JSON data, including instruction-like strings. The adapter loads
no argument files, URLs, remote schemas, modules, credentials or environment
secrets. It does not persist payloads, emit telemetry or run a network service.
stdout carries protocol messages only. Errors use bounded generic codes and
never include raw core exceptions. Input validation/unknown tools are distinct
from tool refusal; `{valid:false}` is a successful negative decision.

The transport closes on a wire buffer above 131,072 bytes; reconnect after that
failure. Tool arguments are limited to 65,536 bytes, depth 16, 256 array items or
object keys, 4,096 total JSON nodes, 32,768 bytes per string and 256 schema nodes.
Output is bounded to 65,536 bytes. Each call runs in a fresh 64 MiB old-generation
worker with a 1,500 ms wall deadline; termination interrupts synchronous schema
compilation/validation. One successor can wait for teardown; additional
concurrent work receives `BUSY`. These finite transport limits narrow accepted
inputs; they are not universal hostile-schema safety certification. Timeout and
cancellation permit a subsequent supported call; disconnect/restart reacquires
the pure computation without a business replay guarantee.

## Install the optional candidate

The npm name is not published by this feature. Build a local tarball from
`integrations/mcp/` in the owning repository:

```sh
npm ci --ignore-scripts --no-audit --no-fund --engine-strict
POLICY_CLI=./node_modules/agent-payment-policy/cli.mjs \
  POLICY_CORE=./node_modules/agent-payment-policy/core.mjs npm run baseline
mkdir -p artifacts
npm pack --ignore-scripts --pack-destination artifacts
```

In a separate consumer directory, install that exact archive:

```sh
npm install --ignore-scripts --save-exact /absolute/path/epistemedeus-agent-payment-policy-mcp-0.1.0.tgz
./node_modules/.bin/agent-payment-policy-mcp
```

Configure a compatible MCP client to launch the resolved executable over stdio.
The process waits for protocol input; running it alone is not a handshake. Use
a client supporting modern `2026-07-28` or official legacy initialization.
Configuration inventory alone does not establish native protocol support.
ROOT3033 qualifies actual `mcpServer/tool/call` calls for all four policy tools
through an ephemeral app-server thread in a disposable empty profile, without
authentication or a model turn. ROOT2981's historical native refusal was a
correct observation of the earlier modern-only package, superseded by this
extension. Model-mediated use and installed adoption remain separate future
receiving. See [release receiving](release/ROOT-RELEASE.md).

The source-only `scripts/cold-receive.py` prepares a fresh client directory and empty npm cache,
acquires that exact local tarball with bounded `npm exec`, then repeats official
modern and legacy discovery/useful/adverse/restart calls without egress. Set `MCP_EVIDENCE_DIR` to an external receipt directory and pass
the exact tarball path; its receipt distinguishes tarball acquisition from a
future public-name install. Linux verification uses libseccomp; other platforms
can use the same official client under their own network isolation.
The finite source-only `scripts/npm-stdio.py` launcher owns and reaps the npm
intermediary's shell descendants during probe, disconnect and restart.

`npm-shrinkwrap.json` is published intentionally: it binds the downstream runtime
dependency graph, unlike an unpublished package-lock. The cold receiver checks
the installed versions and load-bearing bytes. `DEPENDENCIES.json` records the
qualified installed artifacts/integrities and licenses. SDK source maps remain
in the original dependency packages; this adapter ships untranspiled source.

## Sources

The existing public policy core and CLI remain unchanged. Owning source is `epistemedeus/agent-payment-policy`, directory
`integrations/mcp`. The accepted Pilot producer is recorded separately. Final
commit/tree/archive bindings belong in external release receipts. Exact upstream
source and artifact identities appear in `SOURCE-MANIFEST.json`; dependency
licenses appear in `DEPENDENCIES.json` and `NOTICE.md`. The proposed adapter
package/version and registry name have not been published by this candidate.
The source includes the dated `server.json` and focused receiving scripts.
Primary references are
[SDK serving](https://github.com/modelcontextprotocol/typescript-sdk/blob/fcef852f6cdafea07f36cf6fae69b37c8adf85be/docs/serving/stdio.md)
and [registry guidance](https://github.com/modelcontextprotocol/registry/blob/11b7b0e274d518b6f449c5ee3518a6151d9848b9/docs/modelcontextprotocol-io/quickstart.mdx).
