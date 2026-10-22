"""Reuse W3082's direct CLI comparison on the same frozen public-archive case."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

OUT = Path(__file__).resolve().parent
S = OUT.parents[1]/'evidence/ROOT3124'
a = json.loads((OUT/'ACQUISITION.json').read_text())
f = json.loads((OUT/'FROZEN-CASE.json').read_text())
d = S/'direct'
d.mkdir()
rows = []
def file(name, value):
    p = d/name
    p.write_text(json.dumps(value, separators=(',', ':')))
    return str(p)
for c in f['cases']:
    x, tool = c['args'], c['name']
    if tool == 'normalize_request':
        args = ['inspect-json-request', x['target'], file('body.json', x['options']['body'])]
    elif tool == 'inspect_output_schema':
        args = ['output-schema-check', file('schema.json', x['schema']), ','.join(x['requiredFields'])]
    elif tool == 'accept_output':
        args = ['output-accept', file('schema.json', x['schema']), x['schemaDigest'], file('output.json', x['output'])]
    else:
        args = ['receipt-completeness-check', file('receipt.json', x)]
    argv = [shutil.which('node'), '--max-old-space-size=192', a['policyCli'], *args]
    start = time.monotonic()
    p = subprocess.run(argv, env=a['environment'], capture_output=True, text=True, timeout=8)
    expected_exit = 1 if c['expected'] == {'valid': False} else 0
    rows.append({'label': c['label'], 'argv': argv, 'exit': p.returncode, 'expectedExit': expected_exit,
                 'elapsedSeconds': round(time.monotonic()-start, 3), 'actual': json.loads(p.stdout), 'stderrBytes': len(p.stderr)})
    assert p.returncode == expected_exit and json.loads(p.stdout) == c['expected'] and not p.stderr, c['label']
(OUT/'DIRECT-CLI.json').write_text(json.dumps({'ok': True, 'policyCliResolvedFromInventory': a['policyCli'], 'checks': rows}, indent=2)+'\n')
print(json.dumps({'ok': True, 'decisions': len(rows)}))
