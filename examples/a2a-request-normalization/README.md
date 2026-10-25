# Optional A2A request normalization example

This loopback example exposes the repository's unchanged
`normalizeRequest(method, target, options)` through an official A2A client and
server transport. It needs no merchant, account, LLM, hosting or credentials.
It demonstrates normalization and request binding. It provides no authorization,
SSRF safety, settlement verification or payment acceptance decision.

Use a repository checkout with Node.js 22 or newer. Install the main library's
existing dependencies once from the repository root, then install this optional
example's separate dependencies:

```bash
npm ci --ignore-scripts
cd examples/a2a-request-normalization
npm ci --ignore-scripts
node --max-old-space-size=192 --test --test-concurrency=1 *.test.mjs
```

The example uses `@a2a-js/sdk` **1.3.0**, Apache-2.0, published from official
[a2aproject/a2a-js commit 29417a5bb4038f804f310ce4fffd267a9375aa90](https://github.com/a2aproject/a2a-js/tree/29417a5bb4038f804f310ce4fffd267a9375aa90).
The local lockfile pins its transitive `jose` dependency (MIT) and integrity
hashes. No server dependency is added to the main package, and its exports,
CLI, core, payment rules and existing examples are unchanged. These commands
are for the repository checkout; the example is not a separately released package.

Start from this directory:

```bash
node --max-old-space-size=192 server.mjs
```

The server prints one JSON line with its ephemeral `url` and `card` URL.
In another terminal, substitute that actual loopback URL:

```bash
node --max-old-space-size=192 client.mjs http://127.0.0.1:PORT/ \
  '{"method":"GET","target":"https://seller.example/data?asset=ETH"}'
node --max-old-space-size=192 client.mjs http://127.0.0.1:PORT/ \
  '{"method":"POST","target":"https://seller.example/analyze?mode=fast","options":{"body":{"types":["A","MX"],"domain":"buyer.example"},"mediaType":"application/json"}}'
```

The client accepts a JSON argument, never an input filename or a URI to load.
It prints the received Agent Card, terminal task and structured artifact.
Stop the server with Ctrl-C (or SIGTERM to its specific PID); it closes its
listener and connections. No task process should remain. `npm start`,
`npm run client -- URL JSON`, and `npm test` are equivalent local script entries.

For the direct GET baseline from the same directory:

```bash
node ../../cli.mjs inspect-url 'https://seller.example/data?asset=ETH'
```

The artifact's `result` equals that parsed CLI output. The tests compare every
normalized field against the existing function, exercise the existing CLI's
success and refusal paths, and compare exact core error names/messages.

## Exact protocol and skill envelope

The default contract is [A2A 1.0](https://a2a-protocol.org/v1.0.0/specification/),
**JSON-RPC 2.0**, with `A2A-Version: 1.0` and method **`SendMessage`** at `/`.
Discovery is `GET /.well-known/agent-card.json`. The received card advertises
one `JSONRPC` interface at version `1.0` and one `normalize-request` skill.
The official SDK's `DefaultAgentCardResolver`, `ClientFactory` and
`JsonRpcTransportFactory` discover/select/call it. Its server-side
`JsonRpcTransportHandler` and `DefaultRequestHandler` decode/dispatch/serialize
the executor's terminal task and artifact. There is no hand-written alternate
A2A transport or duplicate normalization implementation.

The on-wire request has this form (IDs should be unique):

```json
{
  "jsonrpc": "2.0",
  "id": "request-1",
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "message-1",
      "role": "ROLE_USER",
      "parts": [{
        "mediaType": "application/json",
        "data": {
          "method": "GET",
          "target": "https://seller.example/data?asset=ETH"
        }
      }]
    },
    "configuration": {
      "acceptedOutputModes": ["application/json"],
      "returnImmediately": false,
      "historyLength": 0
    }
  }
}
```

The skill accepts exactly one `application/json` data part, with keys
`method?` (string), `target` (string), and `options?` (object with only `body?`
and `mediaType?`). These are the positional arguments to the existing function;
the wrapper does not validate URLs or methods on the core's behalf. For example,
`BREW` remains accepted if the core accepts it. The bounded JSON skill surface
is narrower than the core's JavaScript coercions and non-JSON object inputs.
The message's part is checked before the SDK's oneof decoder, so a part with
both `data` and `url`, or multiple data parts, cannot silently choose one input.

The returned task has one artifact containing one JSON data part:

- Success: `{"ok":true,"result":<complete unchanged core result>}` with
  `TASK_STATE_COMPLETED`.
- Core refusal: `{"ok":false,"error":{"name":<exact name>,"message":<exact message>}}`
  with `TASK_STATE_REJECTED`. Host-specific JavaScript stacks are omitted.
- Invalid transport/skill envelopes: JSON-RPC errors; invalid JSON is `-32700`,
  invalid request form `-32600`, invalid skill parameters `-32602`, unknown
  methods `-32601`. Known disabled operations retain A2A errors: streaming/extended
  card `-32004`, push notifications `-32003`, unsupported media `-32005`.
  Discarded or unknown tasks return `-32001`; task listing is empty. Version
  errors use the SDK's mapping. HTTP media, size, path and
  local-origin failures use 415/413/404/403, and overlapping calls receive 429.

Without the explicit compatibility option, `message/send`, `role: "user"`,
legacy 0.3 and omitted version headers remain refused. REST `/message:send`, streaming,
batches, notifications, follow-up task calls, push notifications,
URL/file/raw/text parts, compressed input and non-JSON output are unsupported.
This is a synchronous, single-turn example with zero task retention. `GetTask`
returns task-not-found after completion and `ListTasks` returns an empty list.
The card disables streaming, push notifications and extended cards. It has no authentication and must stay local.

## Explicit legacy 0.3 option

The already pinned SDK also publishes a maintained, opt-in
[0.3 compatibility layer](https://github.com/a2aproject/a2a-js/blob/29417a5bb4038f804f310ce4fffd267a9375aa90/src/compat/v0_3/README.md).
Enable it only on the instance intended to serve older callers:

```bash
node --max-old-space-size=192 server.mjs --legacy-0.3
node --max-old-space-size=192 client.mjs http://127.0.0.1:PORT/ \
  '{"method":"GET","target":"https://seller.example/data?asset=ETH"}' --legacy-0.3
```

Library equivalents are `startServer({ legacyCompat: true })` and
`callNormalization(url, input, { protocolVersion: '0.3' })`. Both defaults remain
1.0; the client copies the discovered interface selection for this call and does
not edit a saved card or another caller's configuration. No dependency or lockfile
changes are needed. The SDK's `duplicateInterfacesForLegacy` adds precisely one
0.3 JSONRPC interface beside 1.0. Discovery remains the existing **1.0-shaped**
card at `/.well-known/agent-card.json`; this example does not expose a legacy
card router or REST interface. A caller requiring a 0.3-shaped discovery card
needs a separately supported discovery route; this option proves the declared
JSONRPC invocation interface and the pinned SDK client's explicit selection.

In this mode, `A2A-Version: 0.3` and an omitted header select the SDK's
`LegacyJsonRpcTransportHandler`; `A2A-Version: 1.0` selects the original handler.
Known method names must agree with the selected version. Unsupported versions
(including unadvertised patch/version strings), streaming and push remain refused.
Successful legacy responses carry `A2A-Version: 0.3` and the SDK's 0.3 task shape.
The modern card discovery response retains `A2A-Version: 1.0`.

This **synthetic** request follows the official
[0.3 schema](https://github.com/a2aproject/A2A/blob/v0.3.0/specification/json/a2a.json).
It is not a captured platform payload:

```json
{
  "jsonrpc": "2.0",
  "id": "synthetic-request-1",
  "method": "message/send",
  "params": {
    "message": {
      "kind": "message",
      "messageId": "synthetic-message-1",
      "role": "user",
      "parts": [{
        "kind": "data",
        "data": {"method": "GET", "target": "https://seller.example/data?asset=ETH"}
      }]
    },
    "configuration": {
      "blocking": true,
      "acceptedOutputModes": ["application/json"],
      "historyLength": 0
    }
  }
}
```

A 0.3 `DataPart` is a JSON object with no media-type field. The official codec
decodes it to a native data part with an empty media type; this example admits
only that representation and applies the shared skill/data/size/depth checks
before the executor. A supplied legacy configuration must explicitly say
`blocking: true`; omitting configuration entirely uses synchronous processing.
Part metadata (including the codec's primitive-unwrapping flag), additional part
fields, text/files/URLs, task references and unknown legacy send-parameter,
message or configuration fields are refused before decoding can discard or reinterpret them. Input/body
media rules and exact core refusal names/messages remain unchanged.

The SDK owns both translations and task serialization. Its private `translate/`
modules are not imported or copied. Legacy artifacts contain the same complete
`{ok,result}` or `{ok,error:{name,message}}` envelope in a `kind: "data"` part;
the transport shape differs. `tasks/get` cannot retrieve completed inputs, and
there is no 0.3 `tasks/list` method. The official legacy client also reports that
operation as unsupported. History is forced to zero in both modes.

Tests exercise SDK clients for both versions, headerless legacy synthetic
requests, exact results/refusals and useful recovery, conflicting headers/methods,
strict legacy validation, zero task retention, HTTP/resource bounds, overlap,
close/restart and side-effect traps. This is source/loopback compatibility;
it does not establish a provider adapter repair, hosted use, adoption or revenue.

## Threat model, bounds and side effects

The server binds only `127.0.0.1` on an ephemeral port, checks Host, rejects browser
Origin headers, admits one request at a time, and limits connections to four.
Wire bodies are at most 64 KiB; skill data is at most 16 KiB when re-serialized,
with at most 32 levels of nesting. Request/header/socket timeouts are five
seconds. The demonstration client allows only an explicit numeric loopback URL,
confines discovery and calls to that origin, refuses redirects, and sets timeouts.
These are local experiment bounds, not production security guarantees.

Supplied URLs are strings passed to the core, never network destinations. File
and URL parts are refused before dispatch. The executor has only one core call:
`normalizeRequest`. It never resolves DNS, fetches the target, loads an arbitrary
file, evaluates supplied code, signs, pays, or contacts a model/provider. A
string that resembles a URL, file path or program inside the supplied JSON body
is only body data for canonical binding. The existing core's syntactic URL
checks do not establish DNS or SSRF safety.

The task store discards all writes and always returns no task. The SDK holds
input only during processing; the server applies `historyLength: 0` even if a
caller asks for more. Requests are not logged, written to disk or retained across
calls. Artifacts contain the core's public fields/digests or its exact refusal.
A refusal message may include the supplied method, as the direct core does.

The serial tests cover full results/refusals, query/body/method binding, malformed
JSON, unknown methods, ambiguity, size/depth, media/version/protocol failures,
invalid-to-valid recovery, zero-hit URL/file sentinels, and runtime traps for DNS,
external fetch, arbitrary file reads and signing. The trap tests cover executed
paths; source review establishes the absence of another side-effect path.

## Platform boundary and next consumer

A2A Cloud's public [CLI](https://docs.a2acloud.io/reference/cli),
[control-plane guide](https://docs.a2acloud.io/platform/api),
[quickstart](https://docs.a2acloud.io/quickstart) and
[OpenAPI](https://api.a2acloud.io/openapi.json) were read for this experiment.
They distinguish agent invocation from platform account/registry operations.
Their declared routes and import feature do not prove hosted compatibility or
creator access. This loopback proof tests the standard protocol with the pinned
official SDK. It does not test A2A Cloud import, hosted discovery or invocation,
account entitlement, trial costs, public reach, outside usefulness or revenue.

The transport reference at
[x402-url-extractor 91e14dce308c9d049d6422a4a6570919db46875a](https://github.com/epistemedeus/x402-url-extractor/tree/91e14dce308c9d049d6422a4a6570919db46875a/integrations/agentverse-a2a)
helped distinguish 1.0 wire forms. Its hosted MCP execution was not reused or
called. The stopped merchant remains separate.

Root is the next consumer of the source patch/bundle and evidence. After actual
private import access and a free/hard-capped route are separately received, the
remaining test is to import a privately reachable instance and run the same
synthetic card/client/artifact comparisons through the platform's real caller,
checking version negotiation, unchanged output/refusals, error recovery and
actual per-call economics. Public listing and deployment require separate scope.
