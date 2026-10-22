"""Verify unchanged received identities, consolidate compact facts, retire owned installs."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
S = ROOT/'evidence/ROOT3124'
a = json.loads((OUT/'ACQUISITION.json').read_text())
def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()
def stat(pid):
    try:
        x = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return {'start': int(x[19]), 'state': x[0]}
    except (OSError, IndexError, ValueError):
        return None
for rel, digest in a['packedFiles'].items():
    assert sha(Path(a['installed'])/rel) == digest, rel
for row in a['runtimeInventory']:
    root = Path(row['path']).parent
    files = [str(p.relative_to(root))+'\0'+sha(p) for p in sorted(root.rglob('*'))
             if p.is_file() and 'node_modules' not in p.relative_to(root).parts]
    assert hashlib.sha256('\n'.join(files).encode()).hexdigest() == row['installedTreeSha256'], row['name']
assert sha(S/'received.tgz') == a['archiveSha256']
qualified = {r['name']: r for r in json.loads((ROOT/'DEPENDENCIES.json').read_text())['packages']}
client_inventory = []
for path, entry in json.loads((ROOT/'npm-shrinkwrap.json').read_text())['packages'].items():
    if not path: continue
    root = S/'client'/path
    pkg = json.loads((root/'package.json').read_text())
    assert pkg['version'] == entry['version']
    files = [str(p.relative_to(root))+'\0'+sha(p) for p in sorted(root.rglob('*'))
             if p.is_file() and 'node_modules' not in p.relative_to(root).parts]
    tree = hashlib.sha256('\n'.join(files).encode()).hexdigest()
    assert tree == qualified[pkg['name']]['installedTreeSha256'], pkg['name']
    client_inventory.append({'name': pkg['name'], 'version': pkg['version'], 'installedTreeSha256': tree})
assert sha(OUT/'FROZEN-CASE.json') == json.loads((OUT/'ORACLE-FREEZE.json').read_text())['sha256']
sdk = json.loads((OUT/'SDK-RECEIVING.json').read_text())
direct = json.loads((OUT/'DIRECT-CLI.json').read_text())
assert sdk['ok'] and direct['ok']
for session in sdk['sessions']:
    for c, d in zip(session['checks'], direct['checks'], strict=True):
        assert c['label'] == d['label'] and c['actual'] == d['actual']
rows = [json.loads(line) for line in (S/'commands.jsonl').read_text().splitlines()]
assert all(r['exit'] == 0 and not r['ownedSurvivors'] for r in rows)
residual = []
for r in rows:
    for p in r.get('observedOwnedProcesses', []):
        now = stat(p['pid'])
        if now and now['start'] == p['start'] and now['state'] != 'Z': residual.append(p['pid'])
assert not residual
observed = next(r for r in rows if r['label'] == 'sdk-process-observation')
assert not any(p.get('observedInternetSockets') for p in observed['observedOwnedProcesses'])
recognized = []
unresolved = []
for p in observed['observedOwnedProcesses']:
    argv = p.get('argv', [])
    if not argv:
        unresolved.append({'pid': p['pid'], 'reason': 'process exited during metadata sampling'})
        continue
    assert (argv[0] in ['python3', 'node', 'sh', 'npm exec agent-payment-policy-mcp']), argv
    recognized.append({'pid': p['pid'], 'startTicks': p['start'], 'executable': p['executable'], 'argv': argv})
runtime = Path(shutil.which('node')).resolve()
identity = {'productBase': '239682a8c3429d807b4ad4ce712af8d15268b354',
    'operatingAndAssignmentCommit': 'f8768a1af46d3c46aecb492e965ab46bb5422d76',
    'receiptSha256': '874ee80e0ddfada7284582866a77d572767a9b9fbb6d2a52cd6b0095e22b9a4d',
    'branch': subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip(),
    'cwd': str(Path.cwd()), 'origin': 'https://github.com/epistemedeus/agent-payment-policy.git',
    'priorIndependentReceiving': 'pilot@ad3709035dec2c095bf6de9ea88014772a2675a6:experiments/root3082-policy-mcp-cold-receiving/RESULT.md',
    'nativeModel': 'gpt-6.1-sol', 'effort': 'xhigh', 'modelChildren': 0,
    'node': {'path': str(runtime), 'version': subprocess.check_output(['node', '--version'], text=True).strip(), 'sha256': sha(runtime)},
    'npmVersion': subprocess.check_output(['npm', '--version'], text=True).strip(),
    'nativeAncestorControls': []}
for pid in [359671, 359679]:
    args = Path(f'/proc/{pid}/cmdline').read_bytes().decode().strip('\0').split('\0')
    assert '-m' in args and args[args.index('-m')+1] == 'gpt-6.1-sol'
    assert 'model_reasoning_effort="xhigh"' in args
    identity['nativeAncestorControls'].append({'pid': pid, 'model': args[args.index('-m')+1], 'effort': 'xhigh'})
(OUT/'SOURCE-IDENTITY.json').write_text(json.dumps(identity, indent=2)+'\n')
# Preserve exact command receipts while removing verbose per-sample metadata.
for r in rows:
    p = r.pop('observedOwnedProcesses', None)
    if p is not None:
        r['observedProcessCount'] = len(p)
        r['sampledInternetSocketCount'] = sum(len(x.get('observedInternetSockets', [])) for x in p)
(OUT/'commands.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
(OUT/'RUNTIME-CHECK.json').write_text(json.dumps({'ok': True, 'allPackedAndRuntimeBytesUnchanged': True,
    'clientLockedPackageInventory': client_inventory,
    'sameFrozenCaseMatchesAllSdkSessionsAndDirectCli': True,
    'runtimeCommandProcesses': recognized, 'samplingRaces': unresolved,
    'runtimeInternetSocketObservations': 0, 'networkAuthority': 'Existing no-egress.py denies Internet socket/connect syscalls in client and all descendants',
    'observationLimit': '50ms process/socket sampling is not a complete syscall trace; short-lived metadata can be missed',
    'unexpectedObservedCommands': [], 'ownedLiveResiduals': []}, indent=2)+'\n')
retired = []
for name in ['home', 'consumer', 'npm-cache', 'client', 'client-cache', 'direct', 'readme-home', 'readme-consumer']:
    p = S/name
    assert p.parent == S and p.is_dir() and not p.is_symlink()
    shutil.rmtree(p)
    retired.append({'path': str(p), 'removed': not p.exists()})
(S/'received.tgz').unlink()
logs = [{'path': str(p.relative_to(S)), 'bytes': p.stat().st_size, 'sha256': sha(p)}
        for p in sorted(S.iterdir()) if p.is_file()]
(OUT/'PRIVATE-ARTIFACTS.json').write_text(json.dumps({'ignoredScratch': str(S), 'artifacts': logs}, indent=2)+'\n')
(OUT/'CLEANUP.json').write_text(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'ownedLiveResiduals': [], 'retired': retired, 'receivedScratchArchiveRemoved': True,
    'originalCommittedArchiveUnchanged': True, 'otherJobsAccountsKernelAndHostFloorModified': False,
    'parentOperationRetirementOwner': 'Root after native completion; writer is still active during export'}, indent=2)+'\n')
print(json.dumps({'ok': True, 'retiredInstallDirectories': len(retired), 'ownedLiveResiduals': [],
    'peakSampledTotalWithControlAllowanceKiB': max(r['totalWithAllowanceKiB'] for r in rows)}))
