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
