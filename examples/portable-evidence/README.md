# Portable evidence projection

Thin, credential-free projection of already existing receipt facts. It does not
add a receipt network, a ledger, a paid capture canary, or a seller-signature
verifier.

The projection binds six public-safe fields onto an existing
`createReceipt` object:

| Field | Source | Authority label |
| --- | --- | --- |
| `sellerOfferReceiptId` | caller-supplied `sha256:` of observed x402 `extensions.offer-receipt` format, acceptIndex, payload, and signature bytes. Not EIP-712/JWS-verified. | `caller-supplied-offer-receipt-hash` |
| `buyer.schemaDigest` | policy 0.13+ `createIntent` / `inspectOutputSchema` | `buyer-intent` |
| `buyer.verdict` | `output-accept` | `buyer-output-accept` |
| `responseHash` | existing receipt `output.responseDigest` | `buyer-output-accept` |
| `settlementRef` | existing receipt `settlement.transactionReference` | `caller-supplied-receipt` |
| `decisionChanged` | bounded `;`-joined tokens, max 200 characters | `receipt-completeness-classifier` when completeness is supplied |

`sellerOfferReceiptId` is a hash of caller-supplied offer-receipt bytes. The
helper does not verify a seller signature, `validUntil`, or
amount/payTo/resource binding, so the authority label is
`caller-supplied-offer-receipt-hash`. The old `seller-signed-offer-receipt`
label is rejected because it implied a verified seller receipt identity.

Seller offer-receipt presence does not relax the buyer schema boundary. A
fixture with a live-shaped seller offer-receipt and an omitted buyer
`schemaDigest` fails closed.

This helper does not fetch, load a wallet, sign a payment, send a payment,
verify EIP-712/JWS, or recapture a paid body.

## Seeded refusals

From the repository root, after `npm ci --ignore-scripts`:

```bash
node examples/portable-evidence/project.mjs \
  examples/portable-evidence/fixtures/missing-buyer-schema-digest.json
```

Exit `1`. `evidence` is `null`. Reason `buyer_schema_digest_omitted`.

```bash
DIGEST=$(node --input-type=module -e 'import { inspectOutputSchema } from "./core.mjs"; import { readFileSync } from "node:fs"; const schema = JSON.parse(readFileSync("examples/portable-evidence/fixtures/const-true-schema.json", "utf8")); process.stdout.write(inspectOutputSchema({ schema }).schemaDigest);')
node cli.mjs output-accept \
  examples/portable-evidence/fixtures/const-true-schema.json \
  "$DIGEST" \
  examples/portable-evidence/fixtures/ok-false.json
```

Exit `1`. Stdout is `{ "valid": false }`. The body is not echoed.

```bash
node cli.mjs receipt-completeness-check \
  examples/portable-evidence/fixtures/amount-mismatch-observation.json \
  --fail-on conflict
```

Exit `1`. `state` is `conflict`, `deliveryState` is `invalid`, and
`successProven` remains `true` (settlement success is preserved while delivery
is rejected).

The projection also fails closed, with `evidence: null`, when:

- `buyer.schemaDigest` differs from the existing receipt `output.schemaDigest`;
- the seller `offer-receipt` lists more than one signed offer;
- `buyer.verdict` is `accepted` while completeness `deliveryState` is `invalid`.
