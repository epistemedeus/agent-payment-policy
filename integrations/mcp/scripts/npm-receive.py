#!/usr/bin/env python3
"""Cold exact npm-name/version receiver. A registry failure never falls back."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import importlib.util

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('npm-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def receive(archive, evidence):
    archive = Path(archive).resolve(strict=True)
    evidence = Path(evidence).resolve()
    evidence.mkdir(parents=True, exist_ok=False)
    target = release.NAME+'@'+release.VERSION
    receipt = {'target': target, 'registry': 'https://registry.npmjs.org', 'ok': False,
               'freshHomeAndCaches': True, 'scriptsDisabled': True, 'fallback': False, 'steps': []}
    try:
        with tempfile.TemporaryDirectory(prefix='mcp-npm-name-') as tmp:
            scratch = Path(tmp)
            env = release.clean_env(scratch)
            def run(label, args):
                p = subprocess.run(args, cwd=scratch, env=env, capture_output=True, text=True, timeout=90)
                (evidence/(label+'.stdout')).write_text(p.stdout)
                (evidence/(label+'.stderr')).write_text(p.stderr)
                receipt['steps'].append({'label': label, 'argv': args, 'exit': p.returncode})
                if p.returncode:
                    receipt['failure'] = {'step': label, 'exit': p.returncode,
                                          'npm404': 'E404' in p.stderr, 'stderr': p.stderr[-3000:]}
                    raise RuntimeError(f'{label} failed; no fallback (exit {p.returncode})')
                return p.stdout
            meta = json.loads(run('metadata', ['npm', 'view', target, '--json', '--registry=https://registry.npmjs.org']))
            assert meta['name'] == release.NAME and meta['version'] == release.VERSION, 'registry identity drift'
            receipt['metadata'] = meta
            dist = meta['dist']
            integrity = dist['integrity']
            assert integrity.startswith('sha512-'), 'registry must supply sha512 integrity'
            packed = json.loads(run('pack', ['npm', 'pack', target, '--json', '--ignore-scripts',
                                            '--registry=https://registry.npmjs.org']))
            assert len(packed) == 1 and packed[0]['filename'] == 'epistemedeus-agent-payment-policy-mcp-0.1.0.tgz'
            data = (scratch/packed[0]['filename']).read_bytes()
            assert 'sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode() == integrity, 'registry integrity mismatch'
            assert hashlib.sha256(data).digest() == hashlib.sha256(archive.read_bytes()).digest(), 'published archive differs from reviewed artifact'
            receipt.update(sha256=hashlib.sha256(data).hexdigest(), integrity=integrity,
                           attestations=dist.get('attestations'), signatures=dist.get('signatures'),
                           provenanceVerification='npm audit signatures in existing cold receiver verifies registry signatures and available attestations; success required')
            # Reuse the existing artifact/runtime inventory, SDK oracles, no-egress and npm descendant reaper.
            # Its public mode uses this exact npm name/version again, never the local archive as acquisition.
            args = [sys.executable, str(release.ROOT/'scripts/cold-receive.py'), str(archive),
                    '--public-version', target, '--focused']
            p = subprocess.run(args, cwd=release.ROOT, env={**env, 'MCP_EVIDENCE_DIR': str(evidence)},
                               capture_output=True, text=True, timeout=300)
            (evidence/'sdk.stdout').write_text(p.stdout)
            (evidence/'sdk.stderr').write_text(p.stderr)
            receipt['steps'].append({'label': 'cold-public-sdk', 'argv': args, 'exit': p.returncode})
            assert p.returncode == 0, 'cold public artifact/runtime/SDK receiving failed'
            receipt['ok'] = True
    finally:
        (evidence/'npm-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    return receipt


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive', help='Previously reviewed exact archive for public-byte comparison')
    p.add_argument('--evidence', required=True, help='New external evidence directory')
    a = p.parse_args()
    print(json.dumps(receive(a.archive, a.evidence)))
