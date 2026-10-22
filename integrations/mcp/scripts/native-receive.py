#!/usr/bin/env python3
"""Cold policy receiving through the pinned, read-only v2 producer; no model turn.

Requires an existing official native CLI, canonical Node >=22, Linux x86_64,
and the exact Pilot 23bb53fb profile source closure. Run cold-receive.py with
--keep-scratch first. No acquisition, authentication or installed adoption here.
"""
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('tarball')
parser.add_argument('--cold-receipt', required=True)
parser.add_argument('--profile-source', required=True)
parser.add_argument('--native-cli', required=True)
parser.add_argument('--node', required=True)
opts = parser.parse_args()
evidence = Path(os.environ['MCP_EVIDENCE_DIR']).resolve()
evidence.mkdir(parents=True, exist_ok=True)
source = Path(opts.profile_source).resolve(strict=True)
PRODUCER_FILES = {
    'profile.py':'22de3d0b803168537e0db0184e8769d46aa9aea4e9c8a6d7a210f7f3eb4a58a8',
    'schema-v2.json':'3574289506c80be9d201c1d355edccc4c8b2206c2992e2871c6c27983b5fcf28',
    'test_stdio_native.py':'2f49d064b9ccdb58e5445a66f1545194c78fbb1b53d80d69165bfba442b94471',
    'probe_ownership.py':'d1f49054e211056e94508b580273bc8c669050ac11e795fd742f39431664b573',
    'no_network.py':'d6b66c4a2dd4dd396b9b4a3600f60127bc8b4dc4dd965e1cbe622e48c3d8eacc',
}
for name, expected in PRODUCER_FILES.items():
    assert hashlib.sha256((source/name).read_bytes()).hexdigest() == expected, 'exact read-only producer source required'
sys.path.insert(0, str(source))
producer = importlib.import_module('test_stdio_native')
archive = Path(opts.tarball).resolve(strict=True)
cold = json.loads(Path(opts.cold_receipt).read_text())
digest = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert cold['ok'] and cold['sha256'] == digest(archive)
installed, = (Path(cold['scratch'])/'npm-cache'/'_npx').glob('*/node_modules/@epistemedeus/agent-payment-policy-mcp')
entry = installed/'bin/agent-payment-policy-mcp.mjs'
node = str(Path(opts.node).resolve(strict=True))
native = str(Path(opts.native_cli).absolute())
assert node == opts.node, 'canonical Node required'
with tarfile.open(archive) as tar:
    packed = {str(Path(m.name).relative_to('package')): hashlib.sha256(tar.extractfile(m).read()).hexdigest()
              for m in tar.getmembers() if m.isfile()}
for rel, expected in packed.items():
    assert digest(installed/rel) == expected, 'packed file mismatch'

def runtime_identity():
    rows = []
    roots = [('adapter', installed)] + [(r['name'], Path(r['path']).parent) for r in cold['inventory']]
    for name, root in roots:
        files = []
        for p in sorted(root.rglob('*')):
            if 'node_modules' in p.relative_to(root).parts:
                continue
            if p.is_symlink():
                files.append([str(p.relative_to(root)), 'symlink', os.readlink(p)])
            elif p.is_file():
                files.append([str(p.relative_to(root)), 'sha256', digest(p)])
        rows.append({'name': name, 'root': str(root), 'fileCount': len(files),
                     'filesSha256': hashlib.sha256(json.dumps(files, separators=(',', ':')).encode()).hexdigest()})
    return rows

before = runtime_identity()
expected_inventory = json.loads((evidence/'cold-dual-era.stdout').read_text())['inventory']
case_env = {'PATH':str(Path(node).parent)+':/usr/bin:/bin','HOME':cold['scratch']}
useful = json.loads(subprocess.check_output([node, str(ROOT/'tests/supplier-case.mjs')], env=case_env, text=True))
record = {'schema':'policy-mcp.root3033.native-no-turn.v1', 'ok':False,
          'archiveSha256':digest(archive),'packedFiles':packed,'installed':str(installed),
          'runtimeBefore':before,'node':{'path':node,'sha256':digest(node)},
          'native':{'launcher':native,'resolvedLauncher':str(Path(native).resolve()),'launcherSha256':digest(native)},
          'producer':{'commit':'23bb53fb8806ea3d84514914a307b7a3557a2088',
                      'files':PRODUCER_FILES},
          'sessions':[],'turnStartRequests':0,'modelInferenceRequests':0,
          'authImported':False,'installedAdoption':False,'networkGuard':'read-only producer no_network.py inherited by app-server and descendants'}
native_root = Path(native).resolve().parents[2]
binaries = list(native_root.glob('codex-linux-x64/vendor/*/bin/codex'))
if not binaries:
    binaries = list(native_root.glob('*/vendor/*/codex/codex'))
assert len(binaries) == 1, 'identify actual enrolled native binary'
record['native']['binary'] = str(binaries[0])
record['native']['binarySha256'] = digest(binaries[0])

class Owner(unittest.TestCase):
    def command(self, *args):
        return [sys.executable,str(source/'no_network.py'),sys.executable,str(source/'profile.py'),'run',str(self.profile),*args]

class App(producer.AppServer):
    def request(self, method, params, timeout=15):
        assert method in {'initialize','thread/start','mcpServerStatus/list','mcpServer/tool/call'}, 'no model/inference RPC permitted'
        if method == 'thread/start':
            params['config']['model_reasoning_effort'] = 'max'
        return super().request(method, params, timeout)
    def tool(self, name, args, timeout=15):
        return self.request('mcpServer/tool/call',{'threadId':self.thread,'server':'policy','tool':name,'arguments':args},timeout)

def inventory(value):
    found = {}
    def visit(v):
        if isinstance(v, dict):
            if v.get('name') in {t['name'] for t in expected_inventory} and 'inputSchema' in v:
                found[v['name']] = v
            for child in v.values():visit(child)
        elif isinstance(v,list):
            for child in v:visit(child)
    visit(value)
    return found

def payload(response):
    assert 'result' in response, {'code':response.get('error',{}).get('code')}
    result = response['result']
    assert not result.get('isError',False)
    assert len(result['content']) == 1 and result['content'][0]['type'] == 'text'
    assert json.loads(result['content'][0]['text']) == result['structuredContent']
    return result['structuredContent']

def refusal(response):
    assert 'error' in response or response.get('result',{}).get('isError')
    text = json.dumps(response)
    assert len(text.encode()) < 4096 and 'root3033-do-not-echo' not in text
    if 'error' in response:return {'surface':'native-protocol','code':response['error']['code']}
    result = response['result']
    assert 'structuredContent' not in result
    return {'surface':'tool','code':json.loads(result['content'][0]['text'])['error']['code']}

started = time.monotonic()
scratch = Path(tempfile.mkdtemp(prefix='root3033-native-'))
owner = Owner()
owner.root = scratch
owner.home = scratch/'home';owner.home.mkdir(mode=0o700)
owner.codex_home = owner.home/'.codex';owner.codex_home.mkdir(mode=0o700)
owner.receipts = []
owner.profile = scratch/'full.json'
owner.env = {'PATH':str(Path(node).parent)+':/usr/bin:/bin','HOME':str(owner.home),'CODEX_HOME':str(owner.codex_home),
             'LANG':'C.UTF-8','RUST_LOG':'rmcp=trace,codex_rmcp_client=trace'}
value = {'version':2,'native_cli':native,'servers':[{'name':'policy','transport':'stdio','command':node,
         'args':[str(entry)],'cwd':str(installed),'required':True,
         'enabled_tools':['normalize_request','inspect_output_schema','accept_output','classify_receipt'],
         'source':{'path':str(entry),'sha256':digest(entry)}}]}
def save(name, v):
    owner.profile=scratch/name;owner.profile.write_text(json.dumps(v));owner.profile.chmod(0o600)
def summarize(app, receipt):
    raw=owner.receipts[-1]
    receipt['methods']=[c['request']['method'] for c in raw['calls']]
    receipt['lifecycle']={k:raw[k] for k in ['exit','forcedAppServerStop','ownedIdentities','nativeCleanupResidual','reapedAdoptedPids','liveAfterCleanup']}
    receipt['stderrBytes']=len(raw['stderr'].encode())
    # Only retain initialization-version observations, never raw native events/logs.
    receipt['protocolObservations']=[]
    for line in raw['stderr'].splitlines():
        if 'Service initialized as client' not in line:continue
        match=re.search(r'protocol_version: ProtocolVersion\("(\d{4}-\d{2}-\d{2})"\)',line)
        if match:
            receipt['protocolObservations'].append({'source':'actual native rmcp initialized peer_info',
                'negotiated':match[1],'diagnosticLineSha256':hashlib.sha256(line.encode()).hexdigest()})
    owner.receipts.clear()
    assert receipt['lifecycle']['liveAfterCleanup']==[]
    assert receipt['lifecycle']['nativeCleanupResidual']==[]
    record['sessions'].append(receipt)

try:
    save('full.json',value)
    guard_probe=subprocess.run([sys.executable,str(source/'no_network.py'),sys.executable,'-c',
        'import socket,errno\nfor domain in [socket.AF_INET,socket.AF_INET6]:\n try: socket.socket(domain)\n except OSError as e: assert e.errno==errno.EPERM\n else: raise AssertionError("Internet socket unexpectedly allowed")\nprint("AF_INET and AF_INET6 denied")'],
        env=owner.env,capture_output=True,text=True,timeout=5)
    assert guard_probe.returncode==0
    record['networkGuardProbe']={'exit':guard_probe.returncode,'result':guard_probe.stdout.strip()}
    version=subprocess.run(owner.command('--version'),env=owner.env,capture_output=True,text=True,timeout=10)
    assert version.returncode==0
    record['native']['version']=version.stdout.strip()
    assert record['native']['version']=='codex-cli 0.163.0'
    # A separate exact original-source refusal witnesses what this actual native
    # binary requests. It is a negative control, never a candidate handshake.
    # No baseline implementation is maintained or installed by this receiver.
    baseline=scratch/'original-product';baseline.mkdir(mode=0o700)
    base='a6fb83f3abfa5c028b2356fa9665e24212505727'
    original_files={}
    for rel in packed:
        if rel=='package.json' or rel.startswith(('bin/','src/','policy/')):
            data=subprocess.check_output(['git','-C',str(ROOT.parents[1]),'show',base+':integrations/mcp/'+rel],env=case_env)
            dest=baseline/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
            original_files[rel]=digest(dest)
    (baseline/'node_modules').symlink_to(installed.parents[1],target_is_directory=True)
    prior=json.loads(json.dumps(value));prior_entry=baseline/'bin/agent-payment-policy-mcp.mjs'
    prior['servers'][0].update(args=[str(prior_entry)],cwd=str(baseline),source={'path':str(prior_entry),'sha256':digest(prior_entry)})
    save('original-refusal.json',prior)
    app=App(owner);receipt={'case':'original_product_modern_only_negative_control','checks':[]}
    try:
        app.initialize();failed=app.start(expect_error=True)
        assert failed['error']['code']==-32603
        diagnostic=json.dumps(failed)+app.err.decode(errors='replace')
        match=re.search(r'requested[^0-9]{0,100}(\d{4}-\d{2}-\d{2})',diagnostic)
        assert match, 'actual native requested revision must be observed, not inferred from configuration'
        assert match[1]=='2025-06-18'
        record['nativeRequestedProtocol']={'requested':match[1],'evidence':'actual original-product unsupported-version error data',
            'negativeControlProductBase':base,'originalFileHashes':original_files,'nativeBinarySha256':record['native']['binarySha256'],
            'negotiated':None,'candidateHandshake':False}
        receipt['checks'].append({'case':'original_correct_refusal','code':-32603,'requested':match[1]})
    finally:
        app.close();summarize(app,receipt)
    for restart in [False,True]:
        save('restart.json' if restart else 'full.json',value)
        app=App(owner); receipt={'case':'fresh_restart' if restart else 'all_four_useful_refusal_recovery','checks':[]}
        try:
            app.initialize();app.start()
            status=app.request('mcpServerStatus/list',{'serverName':'policy'})
            listed=inventory(status)
            assert sorted(listed)==sorted(t['name'] for t in expected_inventory), sorted(listed)
            for t in expected_inventory:
                for key in ['inputSchema','outputSchema','annotations']:
                    assert listed[t['name']][key]==t[key], (t['name'],key)
            receipt['checks'].append({'case':'exact_four_tool_schema_annotation_inventory','ok':True})
            for c in useful['cases'] if not restart else [useful['cases'][0], useful['cases'][3]]:
                actual=payload(app.tool(c['name'],c['args']))
                assert actual==c['expected'], c['label']
                receipt['checks'].append({'case':c['label'],'tool':c['name'],'actual':actual,'matchesIndependentExpected':True})
            if not restart:
                for c in useful['refusals']:
                    refused=refusal(app.tool(c['name'],c['args']))
                    receipt['checks'].append({'case':c['label'],**refused,'redacted':True})
                    c0=useful['cases'][0]
                    assert payload(app.tool(c0['name'],c0['args']))==c0['expected']
                receipt['checks'].append({'case':'useful_recovery_after_every_refusal','ok':True})
        finally:
            app.close();summarize(app,receipt)
    reduced=json.loads(json.dumps(value));reduced['servers'][0]['enabled_tools']=['normalize_request']
    save('reduced.json',reduced)
    app=App(owner); receipt={'case':'separate_reduced_allowlist','checks':[]}
    try:
        app.initialize();app.start()
        status=app.request('mcpServerStatus/list',{'serverName':'policy'})
        assert sorted(inventory(status))==['normalize_request']
        for tool in ['accept_output','unknown_policy_tool']:
            refused=refusal(app.tool(tool,{'schema':{},'schemaDigest':'sha256:'+'0'*64,'output':{}}))
            assert refused['surface']=='native-protocol'
            receipt['checks'].append({'case':'filtered_or_unknown','tool':tool,**refused})
        c0=useful['cases'][0];assert payload(app.tool(c0['name'],c0['args']))==c0['expected']
    finally:
        app.close();summarize(app,receipt)
    save('startup.json',value)
    app=App(owner,('-c','mcp_servers.policy.startup_timeout_sec=0.001'))
    receipt={'case':'same_pack_bounded_required_startup_timeout','checks':[]}
    try:
        app.initialize();failed=app.start(expect_error=True)
        assert failed['error']['code']==-32603
        assert 'required MCP servers failed to initialize' in failed['error']['message']
        receipt['checks'].append({'case':'thread_creation_refused','code':-32603})
    finally:
        app.close();summarize(app,receipt)
    save('recovery.json',value)
    app=App(owner);receipt={'case':'fresh_startup_recovery_same_pack','checks':[]}
    try:
        app.initialize();app.start();c0=useful['cases'][0]
        assert payload(app.tool(c0['name'],c0['args']))==c0['expected']
        receipt['checks'].append({'case':c0['label'],'ok':True})
    finally:
        app.close();summarize(app,receipt)
    mismatch=json.loads(json.dumps(value));mismatch['servers'][0]['source']['sha256']='0'*64
    save('hash-mismatch.json',mismatch)
    bad=subprocess.run(owner.command('--version'),env=owner.env,capture_output=True,text=True,timeout=5)
    assert bad.returncode==78 and bad.stdout==''
    assert bad.stderr=='native MCP profile: stdio source digest mismatch\n'
    record['sourceHashMismatch']={'exit':78,'diagnostic':bad.stderr.strip(),'nativeNotLaunched':True,'installedFilesMutated':False}
    assert not (owner.codex_home/'auth.json').exists()
    record['emptyProfileNoAuthFile']=True
    record['runtimeAfter']=runtime_identity()
    assert record['runtimeAfter']==before
    for rel,expected in packed.items():assert digest(installed/rel)==expected
    assert digest(node)==record['node']['sha256']
    assert digest(native)==record['native']['launcherSha256']
    assert digest(binaries[0])==record['native']['binarySha256']
    for name,expected in PRODUCER_FILES.items():assert digest(source/name)==expected
    record['runtimeAndProducerBytesUnchanged']=True
    for session in record['sessions']:
        if session['case'] not in ['original_product_modern_only_negative_control','same_pack_bounded_required_startup_timeout']:
            assert session['protocolObservations']
            assert all(o['negotiated']=='2025-06-18' for o in session['protocolObservations'])
    record['ok']=True
finally:
    owner.doCleanups()
    record['elapsedSeconds']=round(time.monotonic()-started,3)
    (evidence/'native-receiving.json').write_text(json.dumps(record,indent=2)+'\n')
    shutil.rmtree(scratch)
print(json.dumps({'ok':record['ok'],'sessions':len(record['sessions']),
                  'native':record['native'],'elapsedSeconds':record['elapsedSeconds'],
                  'nativeRequestedProtocol':record['nativeRequestedProtocol']['requested'],
                  'negotiatedProtocols':sorted({o['negotiated'] for s in record['sessions'] for o in s['protocolObservations']})}))
