#!/usr/bin/env python3
import hashlib
import os
import json
from pathlib import Path
import sys
import tarfile

root=Path(__file__).resolve().parent.parent
evidence=Path(os.environ['MCP_EVIDENCE_DIR']).resolve()
evidence.mkdir(parents=True, exist_ok=True)
archive=Path(sys.argv[1]).resolve(strict=True)
expected={'DEPENDENCIES.json','LICENSE','NOTICE.md','README.md','SOURCE-MANIFEST.json',
          'bin/agent-payment-policy-mcp.mjs','npm-shrinkwrap.json','package.json','policy/core.mjs',
          'release/SDK-LICENSE.txt','src/isolate.mjs','src/limits.mjs','src/server.mjs','src/tools/index.mjs','src/worker.mjs'}
with tarfile.open(archive) as tar:
    members={str(Path(x.name).relative_to('package')):x for x in tar.getmembers() if x.isfile()}
    assert set(members)==expected, 'pack allowlist mismatch '+str(set(members)^expected)
    for path, member in members.items():
        assert tar.extractfile(member).read()==(root/path).read_bytes(), 'pack/current source drift '+path
    pkg=json.load(tar.extractfile(members['package.json']))
    manifest=json.loads((root/'server.json').read_text())
    assert pkg['mcpName']==manifest['name']
    assert pkg['version']==manifest['version']==manifest['packages'][0]['version']=='0.1.0'
    assert pkg['name']==manifest['packages'][0]['identifier']=='@epistemedeus/agent-payment-policy-mcp'
    assert pkg['bin']=={'agent-payment-policy-mcp':'bin/agent-payment-policy-mcp.mjs'}
    assert members[pkg['bin']['agent-payment-policy-mcp']].mode & 0o111
    assert pkg['license']=='MIT' and pkg['engines']['node']=='>=22'
    assert pkg['repository']=={'type':'git','url':'git+https://github.com/epistemedeus/agent-payment-policy.git','directory':'integrations/mcp'}
    assert manifest['repository']=={'url':'https://github.com/epistemedeus/agent-payment-policy','source':'github','subfolder':'integrations/mcp'}
    source=json.load(tar.extractfile(members['SOURCE-MANIFEST.json']))
    assert source['adapterPublicSource']['repository']==manifest['repository']['url']
    assert source['adapterPublicSource']['directory']==manifest['repository']['subfolder']
    assert source['adapterPublicSource']['role']=='owning source projection'
    lock=json.load(tar.extractfile(members['npm-shrinkwrap.json']))
    assert lock['name']==pkg['name'] and lock['version']==pkg['version']
    assert lock['packages']['node_modules/agent-payment-policy']['version']=='0.15.1'
receipt={'ok':True,'archive':str(archive),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
         'bytes':archive.stat().st_size,'packedFiles':sorted(members),'package':pkg['name'],'version':pkg['version'],
         'mcpName':pkg['mcpName'],'publicSourceBinding':'Owning repository/directory bound; exact commit/tree/archive receipt external'}
(evidence/'pack-inspection.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
