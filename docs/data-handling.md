# Data handling

The core retains a digest of the private machine need and a digest of the full
canonical request. For a JSON POST request, the binding includes the canonical
body digest. Public plan and receipt records contain the HTTP method, origin,
path, query-key names, request-body media type, request-body byte count and
digest, price, recipient, asset, network, timestamps, transaction reference,
response digest, byte count, and output-validation result.

The core does not retain query values, JSON request bodies, headers, cookies,
payment credentials, wallet keys, raw payment challenges, response bodies, or
seller secrets.

Applications remain responsible for local-file permissions, ledger retention,
transaction-reference privacy, and any logging performed outside this module.
