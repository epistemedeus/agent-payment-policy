"""Supplement: npm alone receives SIGTERM; its still-open pipes reach the server."""
import ctypes,json,os,signal,subprocess,sys,time
from pathlib import Path
O=Path(__file__).resolve().parent
ns={'__file__':str(O/'probe.py'),'__name__':'receiver_library'}
exec((O/'probe.py').read_text().split("if len(sys.argv)>1")[0],ns)
ident,descendants=ns['ident'],ns['descendants']
S=Path(json.loads((O/'SCRATCH.json').read_text())['path']);cmd=json.loads((O/'SCRATCH.json').read_text())['readmeCommand']
assert ctypes.CDLL(None).prctl(36,1,0,0,0)==0
p=subprocess.Popen([sys.executable,str(O/'probe.py'),'client','npm-term',str(S),cmd],start_new_session=True)
seen={};snapshots=[];start=time.monotonic();sampled=set()
while p.poll() is None and time.monotonic()-start<15:
 sample=descendants(os.getpid())
 for x in sample:
  k=(x['pid'],x['startTicks'])
  if k not in seen or not seen[k]['command']:seen[k]=x
 events=[json.loads(x) for x in (S/'npm-term.events.jsonl').read_text().splitlines()] if (S/'npm-term.events.jsonl').exists() else []
 sig=next((x for x in events if x.get('signalNpm')),None)
 for t in [.5,3.5,6]:
  if sig and time.monotonic()-sig['at']>=t and t not in sampled:
   sampled.add(t);snapshots.append(dict(secondsAfterSignal=t,identities=sample))
 time.sleep(.01)
p.wait(timeout=1);time.sleep(.5)
before=[i for (pid,t) in seen if (i:=ident(pid)) and i['startTicks']==t];actions=[]
for x in before:
 if x['state']!='Z':os.kill(x['pid'],signal.SIGTERM);actions.append(x['pid'])
time.sleep(.1);reaped=[]
while True:
 try:
  pid,status=os.waitpid(-1,os.WNOHANG)
  if not pid:break
  reaped.append(dict(pid=pid,exit=os.waitstatus_to_exitcode(status)))
 except ChildProcessError:break
after=[i for (pid,t) in seen if (i:=ident(pid)) and i['startTicks']==t]
events=[json.loads(x) for x in (S/'npm-term.events.jsonl').read_text().splitlines()]
(O/'NPM-SIGNAL-BOUNDARY.json').write_text(json.dumps(dict(clientExit=p.returncode,identities=list(seen.values()),snapshots=snapshots,events=events,beforeContainment=before,containmentSignals=actions,adoptedReaped=reaped,afterContainment=after),indent=2)+'\n')
assert not after
assert any(x.get('serverAnsweredAfterLauncherTermination') for x in events)
print(json.dumps(dict(ok=True,clientExit=p.returncode,snapshotSeconds=[x['secondsAfterSignal'] for x in snapshots],zombiesReaped=len(reaped))))
