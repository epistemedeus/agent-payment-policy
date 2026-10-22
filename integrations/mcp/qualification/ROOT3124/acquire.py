"""ROOT3124: adapt ROOT3033/W3082 finite acquisition to the actual public URL."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
SCRATCH = ROOT / 'evidence/ROOT3124'
URL = ('https://raw.githubusercontent.com/epistemedeus/agent-payment-policy/'
       '239682a8c3429d807b4ad4ce712af8d15268b354/'
       'integrations/mcp/qualification/ROOT3033/candidate.tgz')
SHA = 'f45615114494fc7167234743d5a2ff4cda54d20e07de72c49c9e42e6b629c439'
home, consumer, cache, client = [SCRATCH / n for n in ['home', 'consumer', 'npm-cache', 'client']]
for p in [home, consumer, cache, client]:
    p.mkdir()  # Refuse a reused consumer/cache.
empty = SCRATCH / 'empty.npmrc'
empty.write_text('')
env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'NODE_OPTIONS': '--max-old-space-size=192',
       'npm_config_userconfig': str(empty), 'npm_config_globalconfig': str(SCRATCH/'absent-global.npmrc'),
       'npm_config_registry': 'https://registry.npmjs.org', 'npm_config_update_notifier': 'false',
       'npm_config_fetch_retries': '0', 'npm_config_fetch_timeout': '20000'}
steps = []
receipt = {'url': URL, 'steps': steps, 'freshHomeConsumerCaches': True, 'scriptsDisabled': True}

def run(label, argv, cwd, timeout=75):
    start = time.monotonic()
    p = subprocess.run(argv, cwd=cwd, env=env, input='', capture_output=True, text=True, timeout=timeout)
    (SCRATCH/(label+'.stdout')).write_text(p.stdout)
    (SCRATCH/(label+'.stderr')).write_text(p.stderr)
    steps.append({'label': label, 'argv': argv, 'cwd': str(cwd), 'exit': p.returncode,
                  'elapsedSeconds': round(time.monotonic()-start, 3),
                  'stdoutBytes': len(p.stdout.encode()), 'stderrBytes': len(p.stderr.encode())})
    assert p.returncode == 0, (label, p.returncode, p.stderr[-1500:])

try:
    archive = SCRATCH/'received.tgz'
    run('https-fetch', ['curl', '--fail', '--silent', '--show-error', '--location',
        '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '10',
        '--max-time', '30', '--output', str(archive), URL], consumer, 35)
    data = archive.read_bytes()
    assert len(data) == 18633 and hashlib.sha256(data).hexdigest() == SHA
    with tarfile.open(archive) as tar:
        pkg = json.load(tar.extractfile('package/package.json'))
        lock = json.load(tar.extractfile('package/npm-shrinkwrap.json'))
    assert pkg['name'] == '@epistemedeus/agent-payment-policy-mcp' and pkg['version'] == '0.1.0'
    assert pkg['bin'] == {'agent-payment-policy-mcp': 'bin/agent-payment-policy-mcp.mjs'}
    assert lock == json.loads((ROOT/'npm-shrinkwrap.json').read_text())
    receipt.update(archiveBytes=len(data), archiveSha256=SHA, package=pkg['name']+'@'+pkg['version'],
                   bin=pkg['bin'], engines=pkg['engines'], shrinkwrapSha256=hashlib.sha256(
                       (ROOT/'npm-shrinkwrap.json').read_bytes()).hexdigest())
    # Execute the real one-command URL route, not node --version or a local substitute.
    args = ['exec', '--yes', '--ignore-scripts', '--no-audit', '--no-fund', '--engine-strict',
            '--cache', str(cache), '--package='+URL]
    run('npm-url-exec-EOF', ['python3', str(ROOT/'scripts/npm-stdio.py'), 'npm', *args,
                            '--', 'agent-payment-policy-mcp'], consumer)
    installed, = (cache/'_npx').glob('*/node_modules/@epistemedeus/agent-payment-policy-mcp')
    qualified = {r['name']: r for r in json.loads((ROOT/'DEPENDENCIES.json').read_text())['packages']}
    inventory = []
    for path, entry in lock['packages'].items():
        if not path or entry.get('dev'):
            continue
        name = path.removeprefix('node_modules/')
        found = next(p for p in [installed/path/'package.json', installed.parents[1]/name/'package.json'] if p.exists())
        actual = json.loads(found.read_text())
        assert actual['version'] == entry['version']
        files = [str(p.relative_to(found.parent))+'\0'+hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in sorted(found.parent.rglob('*')) if p.is_file()
                 and 'node_modules' not in p.relative_to(found.parent).parts]
        tree = hashlib.sha256('\n'.join(files).encode()).hexdigest()
        assert tree == qualified[name]['installedTreeSha256'], name
        inventory.append({'name': name, 'version': actual['version'], 'integrity': entry['integrity'],
                          'installedTreeSha256': tree, 'path': str(found)})
    packed = {}
    with tarfile.open(archive) as tar:
        for m in tar.getmembers():
            if m.isfile():
                rel = str(Path(m.name).relative_to('package'))
                original = tar.extractfile(m).read()
                assert (installed/rel).read_bytes() == original, rel
                packed[rel] = hashlib.sha256(original).hexdigest()
    binpath = installed.parents[1]/'.bin/agent-payment-policy-mcp'
    assert binpath.resolve() == installed/'bin/agent-payment-policy-mcp.mjs'
    policy = next(Path(r['path']).parent for r in inventory if r['name'] == 'agent-payment-policy')
    for name, digest in json.loads((ROOT/'SOURCE-MANIFEST.json').read_text())['policy']['comparedFiles'].items():
        assert hashlib.sha256((policy/name).read_bytes()).hexdigest() == digest
    cli = policy/json.loads((policy/'package.json').read_text())['bin']['agent-payment-policy']
    # The existing full lock supplies the independent official SDK client, serially.
    for name in ['package.json', 'npm-shrinkwrap.json']:
        shutil.copy(ROOT/name, client/name)
    run('official-client-ci', ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund',
        '--engine-strict', '--cache', str(SCRATCH/'client-cache')], client)
    receipt.update(ok=True, installed=str(installed), entry=str(binpath.resolve()),
                   executable=str(binpath), policyCli=str(cli), runtimeInventory=inventory,
                   packedFiles=packed, npmArgs=args, environment=env,
                   clientLockSha256=hashlib.sha256((client/'npm-shrinkwrap.json').read_bytes()).hexdigest())
finally:
    (OUT/'ACQUISITION.json').write_text(json.dumps(receipt, indent=2)+'\n')
print(json.dumps({'ok': True, 'bytes': len(data), 'sha256': SHA, 'runtimePackages': len(inventory),
                  'packedFiles': len(packed), 'steps': steps}))
