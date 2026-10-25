// Independent synthetic caller oracle: no adapter or policy-core imports.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export const schemaDigest = sha256(canonical(fixtures.schema));
export const boundaryFlags = {
  credentialsUsed: false, walletAccessed: false, paymentSigned: false, paymentSent: false,
};
export function expectedNormalize(body = fixtures.request.body) {
  const serialized = canonical(body);
  if (body === fixtures.request.body) assert.equal(serialized, fixtures.request.canonicalBody);
  const bodyBinding = { mediaType: 'application/json', bytes: Buffer.byteLength(serialized), digest: sha256(serialized) };
  return {
    ...fixtures.request.expected, bodyBinding,
    bindingDigest: sha256(canonical({ method: 'POST', target: fixtures.request.target, bodyBinding })),
  };
}
export const expectedInspection = {
  schemaDigest, canonicalBytes: Buffer.byteLength(canonical(fixtures.schema)),
  requiredPaths: fixtures.expectedRequiredPaths, decision: 'admissible', schemaRetained: false,
  ...boundaryFlags,
};
export function expectedAcceptance(name) {
  return fixtures.expectedOutputAcceptance[name]
    ? { valid: true, responseDigest: sha256(JSON.stringify(fixtures.outputs[name])), schemaDigest }
    : { valid: false };
}
export function receiptObservation(variant) {
  const observation = structuredClone(fixtures.receiptBase);
  Object.assign(observation.receipt, variant.receiptPatch);
  observation.outputValidation = variant.outputValidation;
  return observation;
}
export function expectedReceipt(variant) {
  const observation = receiptObservation(variant);
  return {
    schemaVersion: 'agent-payment-policy.receipt-completeness-report.v1', protocol: 'x402',
    state: variant.state, receiptPresent: observation.receipt.present,
    successProven: observation.receipt.success === 'confirmed',
    transactionReferenceProven: observation.receipt.transactionReference === 'match',
    provenDimensions: variant.provenDimensions, missingDimensions: variant.missingDimensions,
    conflicts: variant.conflicts, supplementedBy: [], deliveryState: variant.deliveryState,
    evidenceBoundary: 'Classifies caller-verified normalized facts. It does not parse raw receipts, verify signatures or transactions, authorize payment, or prove independent demand.',
    rawEvidenceRetained: false, ...boundaryFlags,
  };
}
export const normalizeRefusals = [
  ['missing_post_body', { method: 'POST', target: fixtures.request.target }],
  ['scalar_body', { method: 'POST', target: fixtures.request.target, options: { body: 'not object' } }],
  ['get_body', { method: 'GET', target: fixtures.request.target, options: { body: {} } }],
  ['invalid_method', { method: 'P0ST', target: fixtures.request.target }],
  ['invalid_media_type', { method: 'POST', target: fixtures.request.target, options: { body: {}, mediaType: 'text/plain' } }],
  ['credential_target', { method: 'GET', target: 'https://caller.example/score?api_key=synthetic-do-not-echo' }],
  ['userinfo_target', { method: 'GET', target: 'https://synthetic:do-not-echo@caller.example/score' }],
  ['private_target', { method: 'GET', target: 'https://127.0.0.1/score' }],
  ['local_target', { method: 'GET', target: 'https://worker.internal/score' }],
  ['insecure_target', { method: 'GET', target: 'http://caller.example/score' }],
];
