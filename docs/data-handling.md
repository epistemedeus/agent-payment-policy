# Data handling

The core retains a digest of the private machine need and a digest of the full
canonical request. For a JSON POST request, the binding includes the canonical
body digest. Public plan and receipt records contain the HTTP method, origin,
path, query-key names, request-body media type, request-body byte count and
digest, price, recipient, asset, network, timestamps, transaction reference,
response digest, byte count, and output-validation result.

When an execution authorization is used, it retains the RPC method, network,
canonical full-action digest, action byte count, parent authorization ID, and
short validity window. It does not retain the unsigned or signed action body.

The core does not retain query values, JSON request bodies, execution action
bodies, headers, cookies,
payment credentials, wallet keys, raw payment challenges, response bodies, or
seller secrets.

Applications remain responsible for local-file permissions, ledger retention,
transaction-reference privacy, and any logging performed outside this module.

Wallet-policy observation files contain only a safe profile label, provider,
network, protocol, standardized case names, high-level outcomes, denial class,
and an optional bounded code. They must not contain credentials, wallet IDs,
signatures, transaction bodies, raw provider messages, or nested evidence.
Unknown fields are rejected. The local evaluator does not transmit the file.

Stateful wallet-policy observation files use the same secret-free profile
labels and controlled outcomes. They add only a standardized stateful case and
an enforcement class: `policy`, `application`, `validation`, `provider`, or
`none`. They do not retain counter values, provider IDs, wallet identities,
signed payloads, raw concurrency traces, credentials, or response bodies.

Offer-coherence reports contain the catalog source label, public HTTP method,
origin, path, query-key names, request binding digest, optional request-body
digest and byte count, protocol, atomic amount, network, asset, recipient,
expiry, and per-dimension matched, unknown, or drifted disposition. They do not
retain query values, JSON body values, raw challenge headers, credentials,
cookies, signatures, wallet state, or response bodies. The caller remains
responsible for acquiring and authenticating the catalog and runtime evidence.

Service-deployment statements contain public service origins, exact HTTP
methods and paths, public settlement protocol, network, asset, recipient and
decimals, key ID, issue and expiry timestamps, and a signature. Verification
reports retain only those public bindings plus the verification time. Query
values are excluded. The library does not fetch a public key, access DNS,
accept a credential, access a wallet, authorize a payment, sign a payment, or
send a payment. Applications are responsible for establishing the public
key's authority through a separate identity channel and protecting the
statement-signing private key outside this package.

Response-contract reports retain the public request method, origin and path,
successful status, JSON media type, schema digest, top-level required field
names, controlled structural findings, and the example's structural-consistency
classification. They do not retain the schema, example, query values, response
body, credential, wallet state, signature, or payment. The evaluator performs
no network request and does not authenticate the seller declaration.

Purchase-evidence manifests contain public service origin and version,
protocol labels, exact method and path, read-only effect, response-schema
digest, seller-declared required JSON paths, replay metadata, receipt metadata,
public evidence pointers, boundary statements, and a deterministic digest.
Verified bindings retain only the manifest digest, service version, effect,
response-schema digest, buyer-required paths, and seller-declaration label.
The core performs no network request and retains no query value, request body,
payment credential, wallet state, signature, paid output, or settlement.
