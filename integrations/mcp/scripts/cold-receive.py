#!/usr/bin/env python3
"""Acquire the exact private pack in a fresh npm cache; test with a fresh SDK client."""
import hashlib
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

root = Path(__file__).resolve().parent.parent
evidence = Path(os.environ['MCP_EVIDENCE_DIR']).resolve()
evidence.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('tarball')
parser.add_argument('--public-version', choices=['@epistemedeus/agent-payment-policy-mcp@0.1.0'],
                    help='Root-only later receiving: acquire this exact published name/version and compare to the received tarball')
parser.add_argument('--keep-scratch', action='store_true', help='Retain this new consumer for disposable native configuration; caller must remove it')
parser.add_argument('--unsupported-node', help='Optional checked Node20 binary for packed engine refusal; packed lifecycle controls always run')
arguments = parser.parse_args()
archive = Path(arguments.tarball).resolve(strict=True)
if not archive.is_file() or archive.suffix != '.tgz':
    raise SystemExit('supply the exact packed .tgz')
scratch = Path(tempfile.mkdtemp(prefix='policy-mcp-cold-'))
client = scratch/'client'
consumer = scratch/'consumer'
cache = scratch/'npm-cache'
for path in [client, consumer, cache]:
    path.mkdir()
env = {'PATH': os.environ['PATH'], 'HOME': str(scratch), 'NODE_OPTIONS': '--max-old-space-size=192',
       'npm_config_userconfig': str(scratch/'empty.npmrc'), 'npm_config_registry': 'https://registry.npmjs.org'}
(scratch/'empty.npmrc').write_text('')
steps = []
def run(label, argv, cwd, run_env=None):
    started = time.monotonic()
    result = subprocess.run(argv, cwd=cwd, env=run_env or env, capture_output=True, text=True, timeout=90)
    (evidence/('cold-'+label+'.stdout')).write_text(result.stdout)
    (evidence/('cold-'+label+'.stderr')).write_text(result.stderr)
    steps.append({'label':label,'argv':argv,'cwd':str(cwd),'exit':result.returncode,'elapsedSeconds':round(time.monotonic()-started,3)})
    if result.returncode:
        print(json.dumps({'ok':False,'step':label,'exit':result.returncode,'stderr':result.stderr[-1800:],'stdout':result.stdout[-1800:]}))
        raise SystemExit(result.returncode)
    return result.stdout

receipt = {'acquisition':('exact public name/version via actual npm exec' if arguments.public_version else 'private local tarball via actual npm exec; public name not acquired'),
           'archive':str(archive),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
           'scratch':str(scratch),'steps':steps}
try:
    # Independently locked official client: no symlink/import to author dependencies.
    (client/'package.json').write_text(json.dumps({'name':'policy-mcp-cold-receiver','private':True,'type':'module',
        'dependencies':{'@modelcontextprotocol/client':'2.3.1'}})+'\n')
    shutil.copytree(root/'tests',client/'tests')
    shutil.copy(root/'scripts/audit.mjs',client/'audit.mjs')
    run('client-acquire',['npm','install','--ignore-scripts','--no-audit','--no-fund','--engine-strict','--cache',str(scratch/'client-cache')],client)
    npm_args = ['exec','--yes','--ignore-scripts','--no-audit','--no-fund','--cache',str(cache),
                '--package='+(arguments.public_version or str(archive))]
    run('tarball-acquire',['npm',*npm_args,'--','node','--version'],consumer)
    candidates = list((cache/'_npx').glob('*/node_modules/@epistemedeus/agent-payment-policy-mcp/package.json'))
    assert len(candidates)==1, 'exactly one acquired adapter'
    installed = candidates[0].parent
    pkg = json.loads(candidates[0].read_text())
    assert pkg['name']=='@epistemedeus/agent-payment-policy-mcp' and pkg['version']=='0.1.0'
    assert not installed.is_symlink()
    expected = json.loads((root/'npm-shrinkwrap.json').read_text())['packages']
    inventory = []
    qualified = {row['name']:row for row in json.loads((root/'DEPENDENCIES.json').read_text())['packages']}
    dep_root = installed.parents[1]
    for path, entry in expected.items():
        if not path or entry.get('dev'):
            continue
        name=path.removeprefix('node_modules/')
        # npm may hoist a shrinkwrapped dependency next to the adapter.
        options=[installed/path/'package.json',dep_root/name/'package.json']
        found=next((p for p in options if p.exists()),None)
        assert found, 'missing runtime dependency '+name
        actual=json.loads(found.read_text())
        assert actual['version']==entry['version'], 'shrinkwrap version drift '+name
        files=[]
        for file in sorted(found.parent.rglob('*')):
            if file.is_file() and 'node_modules' not in file.relative_to(found.parent).parts:
                files.append(str(file.relative_to(found.parent))+'\0'+hashlib.sha256(file.read_bytes()).hexdigest())
        tree=hashlib.sha256('\n'.join(files).encode()).hexdigest()
        assert tree==qualified[actual['name']]['installedTreeSha256'], 'cold installed byte drift '+name
        inventory.append({'name':actual['name'],'version':actual['version'],'path':str(found),'installedTreeSha256':tree})
    policy=next(Path(row['path']).parent for row in inventory if row['name']=='agent-payment-policy')
    manifest=json.loads((root/'SOURCE-MANIFEST.json').read_text())
    for name,digest in manifest['policy']['comparedFiles'].items():
        assert hashlib.sha256((policy/name).read_bytes()).hexdigest()==digest, 'cold policy byte drift '+name
    # Verify every shipped adapter file against the tarball itself, independent of author imports.
    import tarfile
    members=[]
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            rel=Path(member.name).relative_to('package')
            assert (installed/rel).read_bytes()==tar.extractfile(member).read(), 'cold pack file drift '+str(rel)
            members.append(str(rel))
    audit=client/'processes.jsonl'
    shutil.copy(root/'scripts/npm-stdio.py',client/'npm-stdio.py')
    runtime_env={**env,'MCP_COMMAND':sys.executable,'MCP_ARGS':json.dumps([str(client/'npm-stdio.py'),'npm',*npm_args,'--offline','--','agent-payment-policy-mcp']),
        'MCP_CWD':str(consumer),'MCP_BIN':str(installed/'bin/agent-payment-policy-mcp.mjs'),'MCP_ENV':json.dumps({**env,'NODE_OPTIONS':'--max-old-space-size=192 --import '+str(client/'audit.mjs'),
            'MCP_PROCESS_AUDIT':str(audit)})}
    for label, script in [('useful','cold.mjs'),('variant','variant.mjs'),('wire','wire.mjs'),
                          ('dual-era','dual-era.mjs'),('era-wire','era-wire.mjs')]:
        output=run(label,[sys.executable,str(root/'scripts/no-egress.py'),'node','--max-old-space-size=256',str(client/'tests'/script)],client,runtime_env)
        receipt[label]=json.loads(output)
    runtime_argv=[sys.executable,str(root/'scripts/no-egress.py'),'node','--max-old-space-size=256',str(client/'tests/runtime-controls.mjs')]
    if arguments.unsupported_node:
        runtime_argv.append(str(Path(arguments.unsupported_node).resolve(strict=True)))
    receipt['runtime']=json.loads(run('runtime',runtime_argv,client,runtime_env))
    receipt.update(ok=True,inventory=inventory,packedFiles=members,
                   clientLockSha256=hashlib.sha256((client/'package-lock.json').read_bytes()).hexdigest(),
                   processAudit=[json.loads(line) for line in audit.read_text().splitlines()])
    # Keep the small lock and exact process receipt, not the full dependency tree.
    shutil.copy(client/'package-lock.json',evidence/'cold-client-package-lock.json')
finally:
    (evidence/'cold-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    if not arguments.keep_scratch:
        shutil.rmtree(scratch)
print(json.dumps({'ok':receipt.get('ok',False),'checks':len(receipt.get('useful',{}).get('checks',[])),
    'wireCases':len(receipt.get('wire',{}).get('cases',[])),'runtimePackages':len(receipt.get('inventory',[])),
    'packedFiles':len(receipt.get('packedFiles',[])),'steps':steps,'scratchRemoved':not scratch.exists()}))
