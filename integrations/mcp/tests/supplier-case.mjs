// Caller-owned synthetic stock reconciliation, frozen before ROOT3033's server edit.
// Expectations use only canonical JSON, SHA256 and the pre-existing caller oracle.
import { canonical, sha256, boundaryFlags, fixtures, receiptObservation, expectedReceipt } from './oracle.mjs';
import { fileURLToPath } from 'node:url';

export const target = 'https://supplier.example/stock?warehouse=west&day=2026-10-22';
export const body = { sku: 'bearing-73', quantities: [4, 7], note: 'synthetic supplier reconciliation' };
export const schema = { type: 'object', additionalProperties: false, required: ['stock'],
  properties: { stock: { type: 'integer', minimum: 0 } } };
export const schemaDigest = sha256(canonical(schema));
export function normalized(value = body) {
  const bodyBinding = { mediaType: 'application/json', bytes: Buffer.byteLength(canonical(value)), digest: sha256(canonical(value)) };
  return { method: 'POST', origin: 'https://supplier.example', pathname: '/stock',
    queryKeys: ['day', 'warehouse'], publicRoute: 'POST https://supplier.example/stock', bodyBinding,
    bindingDigest: sha256(canonical({ method: 'POST', target, bodyBinding })) };
}
const changed = { ...body, quantities: [4, 8] };
export const cases = [
  { label: 'supplier_post_body_binding', name: 'normalize_request', args: { method: 'post', target, options: { body } }, expected: normalized() },
  { label: 'changed_quantity_binding', name: 'normalize_request', args: { method: 'POST', target, options: { body: changed } }, expected: normalized(changed) },
  { label: 'independent_schema_digest_required_paths', name: 'inspect_output_schema', args: { schema, requiredFields: ['stock'] },
    expected: { schemaDigest, canonicalBytes: Buffer.byteLength(canonical(schema)), requiredPaths: ['stock'], decision: 'admissible', schemaRetained: false, ...boundaryFlags } },
  { label: 'valid_stock', name: 'accept_output', args: { schema, schemaDigest, output: { stock: 11 } },
    expected: { valid: true, responseDigest: sha256(JSON.stringify({ stock: 11 })), schemaDigest } },
  ...[{ stock: '11' }, { stock: 11, extra: true }, { stock: -1 }].map((output, i) => ({
    label: ['wrong_stock_type', 'extra_stock_field', 'negative_stock'][i], name: 'accept_output', args: { schema, schemaDigest, output }, expected: { valid: false },
  })),
  { label: 'wrong_schema_digest', name: 'accept_output', args: { schema, schemaDigest: `sha256:${'0'.repeat(64)}`, output: { stock: 11 } }, expected: { valid: false } },
  ...fixtures.receiptVariants.map(variant => ({ label: `supplied_receipt_${variant.name}`, name: 'classify_receipt',
    args: receiptObservation(variant), expected: expectedReceipt(variant) })),
];
export const refusals = [
  { label: 'credential_target', name: 'normalize_request', args: { method: 'GET', target: 'https://supplier.example/?api_key=root3033-do-not-echo' } },
  { label: 'missing_argument', name: 'normalize_request', args: { method: 'GET' } },
  { label: 'wrong_argument_type', name: 'normalize_request', args: { method: 12, target } },
  { label: 'unknown_tool', name: 'unknown_policy_tool', args: {} },
  { label: 'schema_refusal', name: 'inspect_output_schema', args: { schema: { ...schema, $ref: 'https://untrusted.invalid/schema' } } },
];
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify({
  purpose: 'Synthetic supplied stock/output and receipt-fact reconciliation; no funds, settlement or demand established.',
  cases, refusals,
}));
