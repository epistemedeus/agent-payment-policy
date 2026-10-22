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

## Install and launch

With Node.js 22+ and npm, configure your MCP client to launch this command over
stdio from an empty consumer directory:

```sh
npm exec --yes --ignore-scripts --no-audit --no-fund --engine-strict \
  --package=https://raw.githubusercontent.com/epistemedeus/agent-payment-policy/239682a8c3429d807b4ad4ce712af8d15268b354/integrations/mcp/qualification/ROOT3033/candidate.tgz \
  -- agent-payment-policy-mcp
```

This immutable GitHub-hosted archive installs
`@epistemedeus/agent-payment-policy-mcp@0.1.0` and its shrinkwrapped runtime.
The optional npm name is still unpublished. A repository-source archive selects
the separate root CLI package. Initial acquisition downloads dependencies;
policy tool execution is offline. Keep lifecycle scripts disabled.

The process waits for MCP messages; starting it alone does not exercise a tool.
Use a client supporting modern `2026-07-28` or official legacy initialization,
then discover schemas with `tools/list` and invoke the four tools above.

To check the archive independently on a system with curl and sha256sum:

```sh
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 30 --output candidate.tgz \
  https://raw.githubusercontent.com/epistemedeus/agent-payment-policy/239682a8c3429d807b4ad4ce712af8d15268b354/integrations/mcp/qualification/ROOT3033/candidate.tgz
echo 'f45615114494fc7167234743d5a2ff4cda54d20e07de72c49c9e42e6b629c439  candidate.tgz' | sha256sum --check
```

The archive is 18,633 bytes. [Acquisition and useful SDK checks](qualification/ROOT3124/RESULT.md)
record the tested commands, exact runtime, refusal/recovery, restart and direct
policy comparison. Source-only `scripts/npm-stdio.py` provides finite cleanup of
npm's intermediary descendants for clients that need it.

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
