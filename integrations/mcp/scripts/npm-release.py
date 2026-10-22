#!/usr/bin/env python3
"""Finite optional npm preparation/publication. Publication requires hosted OIDC."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
NAME = '@epistemedeus/agent-payment-policy-mcp'
VERSION = '0.1.0'
WORKFLOW = 'epistemedeus/agent-payment-policy/.github/workflows/optional-mcp-release.yml@'


def run(argv, cwd=ROOT, env=None):
    p = subprocess.run(argv, cwd=cwd, env=env, text=True, capture_output=True, timeout=90)
    if p.returncode:
        raise RuntimeError(f'{argv[0]} {argv[1]} refused (exit {p.returncode}): {p.stderr[-2000:]}')
    return p.stdout


def binding(source, version):
    if not re.fullmatch('[0-9a-f]{40}', source):
        raise ValueError('source must be a full lowercase commit SHA')
    if version != VERSION:
        raise ValueError('wrong optional version')
    if Path.cwd().resolve() != ROOT:
        raise ValueError('cwd must be integrations/mcp')
    if run(['git', 'rev-parse', 'HEAD']).strip() != source:
        raise ValueError('source differs from checkout HEAD')
    if run(['git', 'status', '--porcelain', '--untracked-files=normal']).strip():
        raise ValueError('source checkout must be clean (put evidence outside checkout)')
    run(['node', '--max-old-space-size=256', 'release/check-binding.mjs',
         'package.json', 'server.json', 'SOURCE-MANIFEST.json'])


def clean_env(home, oidc=False):
    # Never read account config or inherit npm token/config fallbacks.
    env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'NODE_OPTIONS': '--max-old-space-size=256',
           'npm_config_userconfig': str(home/'empty.npmrc'),
           'npm_config_globalconfig': str(home/'absent-global.npmrc'),
           'npm_config_cache': str(home/'cache'), 'npm_config_registry': 'https://registry.npmjs.org',
           'npm_config_ignore_scripts': 'true', 'npm_config_fetch_retries': '0',
           'npm_config_fetch_timeout': '20000', 'npm_config_update_notifier': 'false'}
    (home/'empty.npmrc').write_text('')
    if oidc:
        env.update({k: v for k, v in os.environ.items() if k.startswith('GITHUB_') or
                    k in ['ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
                          'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'CI']})
    return env


def inspect(archive, evidence):
    run(['python3', '-I', 'scripts/check-pack.py', str(archive)], env={**os.environ, 'MCP_EVIDENCE_DIR': str(evidence)})
    data = archive.read_bytes()
    return {'filename': archive.name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'integrity': 'sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()}


def execute(action, source, version, output, expected_sha256=''):
    binding(source, version)
    output = Path(output).resolve()
    if output == REPO or REPO in output.parents:
        raise ValueError('output must be outside checkout')
    if action == 'prepare':
        output.mkdir(parents=True, exist_ok=False)  # Refuse stale archive/receipt reuse.
        with tempfile.TemporaryDirectory(prefix='mcp-pack-') as tmp:
            env = clean_env(Path(tmp))
            result = json.loads(run(['npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', str(output)], env=env))
        if len(result) != 1 or result[0]['name'] != NAME or result[0]['version'] != version:
            raise ValueError('wrong packed package')
        archive = output/'epistemedeus-agent-payment-policy-mcp-0.1.0.tgz'
        metadata = inspect(archive, output)
        receipt = {'schema': 'optional-mcp-release.v1', 'source': source,
                   'tree': run(['git', 'rev-parse', 'HEAD^{tree}']).strip(),
                   'package': NAME, 'version': version, 'mcpName': 'io.github.epistemedeus/agent-payment-policy-mcp',
                   'archive': metadata, 'action': 'prepare', 'published': False}
        (output/'release.json').write_text(json.dumps(receipt, indent=2)+'\n')
        return receipt
    if not re.fullmatch('[0-9a-f]{64}', expected_sha256):
        raise ValueError('publish requires the separately reviewed archive sha256')
    receipt = json.loads((output/'release.json').read_text())
    if (receipt['schema'], receipt['source'], receipt['package'], receipt['version'], receipt['tree']) != (
            'optional-mcp-release.v1', source, NAME, version, run(['git', 'rev-parse', 'HEAD^{tree}']).strip()):
        raise ValueError('receipt source/package/version/tree mismatch')
    archive = output/'epistemedeus-agent-payment-policy-mcp-0.1.0.tgz'
    metadata = inspect(archive, output)
    if metadata != receipt['archive'] or metadata['sha256'] != expected_sha256:
        raise ValueError('archive differs from reviewed receipt/hash')
    if (os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted' or
            os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch' or
            os.environ.get('GITHUB_REPOSITORY') != 'epistemedeus/agent-payment-policy' or
            os.environ.get('GITHUB_SHA') != source or
            not os.environ.get('GITHUB_WORKFLOW_REF', '').startswith(WORKFLOW) or
            not all(os.environ.get(k) for k in ['ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'])):
        raise ValueError('publish requires this manual GitHub-hosted workflow with OIDC; no token fallback')
    with tempfile.TemporaryDirectory(prefix='mcp-oidc-') as tmp:
        env = clean_env(Path(tmp), oidc=True)
        npm_version = run(['npm', '--version'], cwd=Path(tmp), env=env).strip()
        if tuple(map(int, npm_version.split('.'))) < (11, 5, 1):
            raise ValueError('OIDC requires npm >=11.5.1')
        # One official npm attempt, no retry or credential fallback. Isolated cwd excludes project .npmrc.
        run(['npm', 'publish', str(archive), '--access', 'public', '--provenance', '--ignore-scripts',
             '--registry=https://registry.npmjs.org'], cwd=Path(tmp), env=env)
    return {'source': source, 'archive': metadata, 'published': True}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['prepare', 'publish'])
    p.add_argument('--source', required=True)
    p.add_argument('--version', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--sha256', default='')
    a = p.parse_args()
    print(json.dumps(execute(a.action, a.source, a.version, a.output, a.sha256)))


if __name__ == '__main__':
    main()
