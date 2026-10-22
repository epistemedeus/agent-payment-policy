"""Independent synthetic case: plain JSON/SHA256, no policy or producer oracle."""
import datetime
import hashlib
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
def canonical(x):
    return json.dumps(x, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
def digest(x):
    return 'sha256:'+hashlib.sha256(x.encode()).hexdigest()
target = 'https://supplier.example/packing?region=eu&batch=24'
body = {'sku': 'gasket-24', 'cartons': 6, 'unitsPerCarton': 8}
schema = {'type': 'object', 'additionalProperties': False, 'required': ['units', 'ready'],
          'properties': {'units': {'type': 'integer', 'minimum': 1}, 'ready': {'type': 'boolean'}}}
output = {'units': 48, 'ready': True}
sd = digest(canonical(schema))
binding = {'mediaType': 'application/json', 'bytes': len(canonical(body).encode()), 'digest': digest(canonical(body))}
flags = dict(credentialsUsed=False, walletAccessed=False, paymentSigned=False, paymentSent=False)
cases = [
    {'label': 'packing_request_binding', 'name': 'normalize_request',
     'args': {'method': 'POST', 'target': target, 'options': {'body': body}},
     'expected': {'method': 'POST', 'origin': 'https://supplier.example', 'pathname': '/packing',
                  'queryKeys': ['batch', 'region'], 'publicRoute': 'POST https://supplier.example/packing',
                  'bodyBinding': binding, 'bindingDigest': digest(canonical({'method': 'POST', 'target': target, 'bodyBinding': binding}))}},
    {'label': 'packing_schema', 'name': 'inspect_output_schema',
     'args': {'schema': schema, 'requiredFields': ['units', 'ready']},
     'expected': {'schemaDigest': sd, 'canonicalBytes': len(canonical(schema).encode()),
                  'requiredPaths': ['ready', 'units'], 'decision': 'admissible', 'schemaRetained': False, **flags}},
    {'label': 'packing_accepted', 'name': 'accept_output',
     'args': {'schema': schema, 'schemaDigest': sd, 'output': output},
     'expected': {'valid': True, 'schemaDigest': sd, 'responseDigest': digest(json.dumps(output, separators=(',', ':')))}},
    {'label': 'wrong_units_type', 'name': 'accept_output',
     'args': {'schema': schema, 'schemaDigest': sd, 'output': {'units': '48', 'ready': True}}, 'expected': {'valid': False}},
    {'label': 'wrong_schema_digest', 'name': 'accept_output',
     'args': {'schema': schema, 'schemaDigest': 'sha256:'+'0'*64, 'output': output}, 'expected': {'valid': False}},
]
for validation, delivery in [('failed', 'invalid'), ('passed', 'valid')]:
    observation = {'schemaVersion': 'agent-payment-policy.receipt-completeness-observation.v1', 'protocol': 'x402',
        'receipt': {'present': True, 'success': 'confirmed', 'transactionReference': 'match',
                    'amount': 'match', 'network': 'match', 'asset': 'match', 'recipient': 'missing', 'payer': 'match'},
        'transaction': {'checked': False, 'success': 'unknown', 'transactionReference': 'not_checked',
                        **{k: 'not_checked' for k in ['amount', 'network', 'asset', 'recipient', 'payer']}},
        'balance': {'checked': False, 'delta': 'not_checked', 'asset': 'not_checked', 'payer': 'not_checked'},
        'outputValidation': validation}
    expected = {'schemaVersion': 'agent-payment-policy.receipt-completeness-report.v1', 'protocol': 'x402',
        'state': 'partial', 'receiptPresent': True, 'successProven': True, 'transactionReferenceProven': True,
        'provenDimensions': ['amount', 'network', 'asset', 'payer'], 'missingDimensions': ['recipient'],
        'conflicts': [], 'supplementedBy': [], 'deliveryState': delivery,
        'evidenceBoundary': 'Classifies caller-verified normalized facts. It does not parse raw receipts, verify signatures or transactions, authorize payment, or prove independent demand.',
        'rawEvidenceRetained': False, **flags}
    cases.append({'label': 'partial_receipt_'+delivery, 'name': 'classify_receipt', 'args': observation, 'expected': expected})
frozen = {'purpose': 'Owner QA: synthetic packing response and controlled receipt facts; no outside use or money.',
    'oracle': 'Independent JSON/SHA256 and documented controlled-fact rules; no imported expected outputs.',
    'inventoryNames': ['accept_output', 'classify_receipt', 'inspect_output_schema', 'normalize_request'],
    'cases': cases, 'refusal': {'name': 'normalize_request', 'args': {'method': 'GET',
        'target': 'https://supplier.example/?api_key=root3124-synthetic-do-not-echo'}}}
p = OUT/'FROZEN-CASE.json'
assert not p.exists(), 'do not rewrite a used oracle'
p.write_text(json.dumps(frozen, indent=2)+'\n')
(OUT/'ORACLE-FREEZE.json').write_text(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'cases': len(cases), 'beforeToolCalls': True}, indent=2)+'\n')
print(json.dumps({'ok': True, 'cases': len(cases), 'schemaDigest': sd}))
