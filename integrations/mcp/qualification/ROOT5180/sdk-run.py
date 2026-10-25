"""Observe official client; adopt/reap only after its own lifecycle result."""
import ctypes,json,os,signal,subprocess,time
from pathlib import Path
O=Path(__file__).resolve().parent
# Reuse identity/lineage definitions without running the raw client suite.
ns={'__file__':str(O/'probe.py'),'__name__':'receiver_library'}
exec((O/'probe.py').read_text().split("if len(sys.argv)>1")[0],ns)
ident,descendants=ns['ident'],ns['descendants']
assert ctypes.CDLL(None).prctl(36,1,0,0,0)==0
p=subprocess.Popen(['python3',str(O.parents[1]/'scripts/no-egress.py'),'node','--max-old-space-size=256',str(O/'sdk.mjs')],start_new_session=True)
seen={};peak=0;start=time.monotonic()
while p.poll() is None and time.monotonic()-start<60:
 sample=descendants(os.getpid());peak=max(peak,sum(x['rssKiB'] for x in sample)+ident(os.getpid())['rssKiB'])
 for x in sample:
  k=(x['pid'],x['startTicks'])
  if k not in seen or not seen[k]['command']:seen[k]=x
 time.sleep(.01)
before=[i for (pid,t) in seen if (i:=ident(pid)) and i['startTicks']==t]
actions=[]
for sig in [signal.SIGTERM,signal.SIGKILL]:
 for x in before:
  i=ident(x['pid'])
  if i and i['startTicks']==x['startTicks'] and i['state']!='Z':os.kill(x['pid'],sig);actions.append(dict(pid=x['pid'],signal=sig.name))
 time.sleep(.1)
p.wait();reaped=[]
while True:
 try:
  pid,status=os.waitpid(-1,os.WNOHANG)
  if not pid:break
  reaped.append(dict(pid=pid,exit=os.waitstatus_to_exitcode(status)))
 except ChildProcessError:break
after=[i for (pid,t) in seen if (i:=ident(pid)) and i['startTicks']==t]
(O/'SDK-PROCESSES.json').write_text(json.dumps(dict(exit=p.returncode,firstIdentities=list(seen.values()),beforeContainment=before,signals=actions,adoptedReaped=reaped,afterContainment=after,peakReceiverDescendantsKiB=peak,elapsedSeconds=round(time.monotonic()-start,3)),indent=2)+'\n')
assert not after
raise SystemExit(p.returncode)
