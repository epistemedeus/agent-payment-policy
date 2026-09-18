# HTTP 402 PAYMENT-REQUIRED is not PAYMENT-RESPONSE

Credential-free classifier. An unpaid HTTP 402 with `PAYMENT-REQUIRED` is not
the well-known `operations[].receipt.x402` value `PAYMENT-RESPONSE with signed
offer-receipt extension and settlement reference`, and it is not
`createReceipt.settlement.transactionReference`.

Well-known SameDayDesk evidence (service `1.23.49`, captured
`2026-09-17T11:30:14Z`) declares that receipt header on every operation,
including `GET /extract`. The live unpaid `GET /extract?url=https://example.com`
at that time returned HTTP 402, `error: "Payment required"`, a
`PAYMENT-REQUIRED` header, and **no** `PAYMENT-RESPONSE` header.

This helper projects `settlementRef` only from a **separate existing**
`createReceipt`. It does not fetch, load a wallet, sign a payment, send a
payment, verify EIP-712, or recapture a paid body.

## Pass

From the repository root (no `npm ci` required):

```bash
node examples/portable-evidence/http402-not-payment-response/classify.mjs \
  examples/portable-evidence/http402-not-payment-response/fixtures/pass-402-plus-separate-receipt.json
```

Exit `0`. `unpaid402Class` is `PAYMENT-REQUIRED`. `paymentResponse` is
`missing`. `evidence.settlementRef` is the existing receipt
`0xadoptionfixture`. `evidence.settlementRefSource` is
`caller-supplied-receipt`. Well-known `receipt.x402` remains a declaration:
`wellKnownSatisfiedByThisResponse` is `false`.

## Seeded refusals

```bash
node examples/portable-evidence/http402-not-payment-response/classify.mjs \
  examples/portable-evidence/http402-not-payment-response/fixtures/seeded-402-as-settlement-ref.json
```

Exit `1`. `evidence` is `null`. Reason `payment_response_missing`.

```bash
node examples/portable-evidence/http402-not-payment-response/classify.mjs \
  examples/portable-evidence/http402-not-payment-response/fixtures/seeded-treat-absence-as-demand.json
```

Exit `1`. Reason `absence_is_not_demand`.

```bash
node examples/portable-evidence/http402-not-payment-response/classify.mjs \
  examples/portable-evidence/http402-not-payment-response/fixtures/seeded-invented-field.json
```

Exit `1`. Reason `invented_receipt_field`. `loyaltyPoints` is not a live 402
or `createReceipt` field.

```bash
node examples/portable-evidence/http402-not-payment-response/classify.mjs \
  examples/portable-evidence/http402-not-payment-response/fixtures/seeded-well-known-as-settlement-ref.json
```

Exit `1`. Reason `payment_response_missing`. Seller-declared well-known text
is not a live `PAYMENT-RESPONSE` header.

```bash
node examples/portable-evidence/http402-not-payment-response/classify.mjs \
  examples/portable-evidence/http402-not-payment-response/fixtures/seeded-string-true-absence-as-demand.json
```

Exit `1`. Reason `absence_is_not_demand`. String `"true"` (also `1` / `"yes"`) does not bypass the boolean demand flags.

```bash
node examples/portable-evidence/http402-not-payment-response/classify.mjs \
  examples/portable-evidence/http402-not-payment-response/fixtures/seeded-well-known-negation.json
```

Exit `1`. Reason `well_known_receipt_x402_missing`. A well-known string that merely contains `PAYMENT-RESPONSE` is not `operations[].receipt.x402`.

```bash
node examples/portable-evidence/http402-not-payment-response/classify.mjs \
  examples/portable-evidence/http402-not-payment-response/fixtures/seeded-402-receipt-with-digest.json
```

Exit `1`. Reason `payment_response_missing`. A `PAYMENT-REQUIRED` body with a fake `receiptId` digest is not `createReceipt`.

```bash
node examples/portable-evidence/http402-not-payment-response/classify.mjs \
  examples/portable-evidence/http402-not-payment-response/fixtures/seeded-payment-response-header.json
```

Exit `1`. Reason `unpaid_402_carries_payment_response`. `paymentResponse` is `present` (not `missing`).

```bash
node examples/portable-evidence/http402-not-payment-response/classify.mjs --live
```

Exit `2`. Reason `live_or_payment_refused`. `--live` / `--pay` / `--fetch` are not filenames.

The classifier also fails closed, with `evidence: null`, when:

- HTTP status is not the JSON number `402` (`"402"` / `[402]` rejected);
- `x402Version` is not the number `2`;
- `PAYMENT-REQUIRED` is absent, or `PAYMENT-RESPONSE` / `PAYMENT-SIGNATURE` is present;
- the unpaid body already carries `transactionReference` or `settlementRef`;
- the 402 body is supplied as `receipt`;
- an existing receipt is missing (`existing_receipt_required`);
- the observation file exceeds 256 KiB (`observation_too_large`).

## Boundary

Disjoint from R6-04 offer-receipt hashing and from R11-PE-01 amount equality.
Do not pay to obtain `PAYMENT-RESPONSE`. Do not claim the live 402 body carries
`settlement.transactionReference`.
