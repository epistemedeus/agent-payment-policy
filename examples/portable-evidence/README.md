# Offer-settlement equality (portable evidence)

Fail-closed adapter: a live x402 `offer-receipt` payload
`amount` / `network` / `asset` / `payTo` must equal an existing
`createReceipt.settlement` `amountAtomic` / `network` / `asset` / `recipient`.

It does not hash the signed offer blob, verify EIP-712 or JWS, create a ledger,
recapture a paid body, load a wallet, send a payment, convert atomic units, or
treat a missing payload amount as demand. Unpaid HTTP 402 is not a settlement
source: an injected `settlement` object on the 402 envelope, or a 402 envelope
used as `receipt`, is refused. `transactionReference` stays on the existing
receipt; live 402 payloads do not carry it. Bind/compare field names must be
payload `amount`/`network`/`asset`/`payTo` or settlement `amountAtomic`/
`network`/`asset`/`recipient`.

Compared fields are the live offer-receipt payload keys captured
2026-09-17T11:30:14Z from `GET /extract?url=https://example.com`
(`payload.amount="5000"`, `network="eip155:8453"`,
`asset="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"`,
`payTo="0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee"`). Invented names such as
`loyaltyPoints` are refused if requested as bind fields and are never copied
into evidence.

## Cold run

From the repository root, after `npm ci --ignore-scripts`:

```bash
node examples/portable-evidence/offer-settlement-gate.mjs \
  examples/portable-evidence/fixtures/matching-offer-settlement.json
```

Exit `0`. `evidence.compared.amount` is `{ payload: "5000", settlement: "5000", equal: true }`
and the same for `network`, `asset`, and `payTo`. `boundary.sellerSignatureVerified` is `false`.

```bash
node examples/portable-evidence/offer-settlement-gate.mjs --create-receipt \
  examples/portable-evidence/fixtures/create-receipt-aligned-offer.json
```

Exit `0`. Settlement is the adoption example `createReceipt` object
(`amountAtomic` `"10000"`, `recipient` `0x2222…`). The offer payload is aligned
to that receipt, not to the live SDS 402.

## Seeded refusals

```bash
node examples/portable-evidence/offer-settlement-gate.mjs \
  examples/portable-evidence/fixtures/seeded-amount-mismatch.json
```

Exit `1`. `evidence` is `null`. Reason `offer_settlement_mismatch`. Payload
amount `"1"` against settlement `amountAtomic` `"5000"`. `accepts[0].amount`
stays `"5000"` and does not override the payload.

```bash
node examples/portable-evidence/offer-settlement-gate.mjs \
  examples/portable-evidence/fixtures/seeded-missing-payload-amount.json
```

Exit `1`. `evidence` is `null`. Reason `offer_settlement_mismatch`. A missing
payload `amount` is not treated as demand.

```bash
node examples/portable-evidence/offer-settlement-gate.mjs \
  examples/portable-evidence/fixtures/seeded-invented-field.json
```

Exit `1`. `evidence` is `null`. Reason `invented_receipt_field` (`loyaltyPoints`).

```bash
node examples/portable-evidence/offer-settlement-gate.mjs --create-receipt \
  examples/portable-evidence/fixtures/live-402-offer-receipt.json
```

Exit `1`. Live payload amount `"5000"` / `payTo` `0x8904…` against the adoption
`createReceipt.settlement` amount `"10000"` / recipient `0x2222…`.

```bash
node examples/portable-evidence/offer-settlement-gate.mjs \
  examples/portable-evidence/fixtures/seeded-402-injected-settlement.json
```

Exit `1`. `evidence` is `null`. Reason `unpaid_402_is_not_settlement`. Matching
payload and injected `settlement.amountAtomic` `"5000"` do not make the unpaid
402 a receipt.

```bash
node examples/portable-evidence/offer-settlement-gate.mjs \
  examples/portable-evidence/fixtures/seeded-unknown-bind-field.json
```

Exit `1`. `evidence` is `null`. Reason `invented_receipt_field` (`discountCode`).
