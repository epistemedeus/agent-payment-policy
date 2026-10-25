"""Execute the README's two acquisition blocks with an empty HOME and npm cache."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
S = ROOT/'evidence/ROOT3124'
home, consumer = S/'readme-home', S/'readme-consumer'
home.mkdir()
consumer.mkdir()
a = json.loads((OUT/'ACQUISITION.json').read_text())
env = {**a['environment'], 'HOME': str(home)}
blocks = re.findall(r'```sh\n(.*?)\n```', (ROOT/'README.md').read_text(), re.S)
assert len(blocks) == 2
steps = []
for index, block in enumerate(blocks):
    argv = ['sh', '-eu', '-c', block]
    start = time.monotonic()
    p = subprocess.run(argv, cwd=consumer, env=env, input='', capture_output=True, text=True, timeout=65)
    (S/f'readme-{index}.stdout').write_text(p.stdout)
    (S/f'readme-{index}.stderr').write_text(p.stderr)
    steps.append({'argv': argv, 'cwd': str(consumer), 'exit': p.returncode,
                  'elapsedSeconds': round(time.monotonic()-start, 3),
                  'stdout': p.stdout, 'stderr': p.stderr})
    assert p.returncode == 0, steps[-1]
archive = consumer/'candidate.tgz'
assert archive.stat().st_size == 18633 and hashlib.sha256(archive.read_bytes()).hexdigest() == a['archiveSha256']
(OUT/'README-CHECK.json').write_text(json.dumps({'ok': True, 'freshHomeAndDefaultCache': True,
    'launchInput': 'EOF; useful calls separately in SDK-RECEIVING.json', 'steps': steps}, indent=2)+'\n')
print(json.dumps({'ok': True, 'readmeCommands': len(steps), 'archiveBytes': archive.stat().st_size}))
