#!/usr/bin/env python3
"""Finite Linux lifecycle receiver. Observe first; contain only captured own identities.
The subreaper is evidence/containment, never part of the launched README command.
"""
import ctypes, hashlib, json, os, re, select, shlex, signal, subprocess, sys, tarfile, tempfile, time
from pathlib import Path
O=Path(__file__).resolve().parent
R=O.parents[1]
F=json.loads((R/'qualification/ROOT3124/FROZEN-CASE.json').read_text())
BLOCK=re.findall(r'```sh\n(.*?)\n```', (R/'README.md').read_text(), re.S)[0]
SHA='f45615114494fc7167234743d5a2ff4cda54d20e07de72c49c9e42e6b629c439'
def dump(p,x): p.write_text(json.dumps(x,indent=2)+'\n')
def ident(pid):
    try:
        s=Path(f'/proc/{pid}/stat').read_text().split(') ')[1].split()
        return dict(pid=pid,startTicks=s[19],state=s[0],ppid=int(s[1]),pgid=int(s[2]),rssKiB=int(s[21])*4,
            cwd=os.readlink(f'/proc/{pid}/cwd') if s[0]!='Z' else None,
            command=Path(f'/proc/{pid}/cmdline').read_bytes().replace(b'\0',b' ').decode(errors='replace').strip())
    except (FileNotFoundError,ProcessLookupError): return None
def descendants(pid):
    try: children=Path(f'/proc/{pid}/task/{pid}/children').read_text().split()
    except FileNotFoundError: return []
    out=[]
    for p in children:
        i=ident(int(p))
        if i: out.append(i);out.extend(descendants(int(p)))
    return out

def client(mode,S,cmd):
    env=dict(PATH=os.environ['PATH'], HOME=str(S/'home'), NODE_OPTIONS='--max-old-space-size=256',
      npm_config_ignore_scripts='true',npm_config_userconfig=str(S/'empty.npmrc'),
      npm_config_globalconfig=str(S/'absent-global.npmrc'),npm_config_registry='https://registry.npmjs.org',
      npm_config_update_notifier='false',npm_config_fetch_retries='0',npm_config_fetch_timeout='20000')
    log=open(S/(mode+'.events.jsonl'),'w',buffering=1)
    def event(**x): log.write(json.dumps(dict(at=time.monotonic(),**x))+'\n')
    p=subprocess.Popen(shlex.split(cmd.replace('\\\n','')),cwd=S/'consumer',env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open(S/(mode+'.stderr'),'w'),bufsize=0)
    event(launch=p.pid,argv=shlex.split(cmd.replace('\\\n','')),cwd=str(S/'consumer'))
    if mode=='startup-client-term':
        time.sleep(.02);event(readyForSignal=True)
        time.sleep(10);return
    seq=0;buf=b''
    def send(x): p.stdin.write(json.dumps(x,separators=(',',':')).encode()+b'\n')
    def rpc(method,params):
        nonlocal seq,buf
        seq+=1;send(dict(jsonrpc='2.0',id=seq,method=method,params=params));until=time.monotonic()+30
        while time.monotonic()<until:
            if b'\n' not in buf:
                if not select.select([p.stdout],[],[],.1)[0]:continue
                b=os.read(p.stdout.fileno(),65536)
                if not b:raise RuntimeError('EOF waiting '+method)
                buf+=b;continue
            line,buf=buf.split(b'\n',1);m=json.loads(line)
            if m.get('id')==seq:return m
        raise RuntimeError('timeout '+method)
    init=rpc('initialize',dict(protocolVersion='2025-06-18',capabilities={},clientInfo=dict(name='root5180-lifecycle',version='1')))
    assert init['result']['protocolVersion']=='2025-06-18',init
    send(dict(jsonrpc='2.0',method='notifications/initialized'))
    event(initialized=True)
    for c in [F['cases'][0],F['cases'][2],F['cases'][3]]:
        reply=rpc('tools/call',dict(name=c['name'],arguments=c['args']))['result']
        assert reply.get('isError')!=True and reply['structuredContent']==c['expected'],reply
        event(decision=c['label'],result=reply)
    bad=rpc('tools/call',dict(name=F['refusal']['name'],arguments=F['refusal']['args']))['result']
    assert bad['isError'] and 'root3124-synthetic-do-not-echo' not in json.dumps(bad),bad
    event(refusal=bad)
    if mode in ['pending-close','pending-client-term']:
        schema=dict(type='object',properties=dict(value=dict(type='string',pattern='^(a+)+$')),required=['value'],additionalProperties=False)
        # Existing runtime-controls workload: bounded worker, no invented async service.
        canon=json.dumps(schema,sort_keys=True,separators=(',',':')).encode()
        send(dict(jsonrpc='2.0',id=100,method='tools/call',params=dict(name='accept_output',arguments=dict(schema=schema,schemaDigest='sha256:'+hashlib.sha256(canon).hexdigest(),output=dict(value='a'*128+'!')))))
        time.sleep(.15);event(outstandingRequest=100)
    if mode in ['initialized-client-term','pending-client-term']:
        event(readyForSignal=True);time.sleep(10);return
    if mode=='npm-term':
        event(signalNpm=p.pid);p.terminate();time.sleep(4)
    elif mode in ['abrupt-close','pending-close']:
        p.stdout.close();p.stdin.close();event(closedInputOutput=True)
    else:
        p.stdin.close();event(stdinEOF=True)
    try:event(launcherExit=p.wait(timeout=4))
    except subprocess.TimeoutExpired:event(launcherTimedOut=True)
    # Keep descriptors alive during the observation window in the npm-only case.
    if mode=='npm-term':
        c=F['cases'][0]
        retained=rpc('tools/call',dict(name=c['name'],arguments=c['args']))['result']
        assert retained['structuredContent']==c['expected'],retained
        event(serverAnsweredAfterLauncherTermination=retained)
        time.sleep(3)

if len(sys.argv)>1 and sys.argv[1]=='client':
    client(sys.argv[2],Path(sys.argv[3]),sys.argv[4]);sys.exit(0)

assert ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0
S=Path(tempfile.mkdtemp(prefix='r5180-'))
for n in ['home','consumer']: (S/n).mkdir()
(S/'empty.npmrc').write_text('')
dump(O/'SCRATCH.json',dict(path=str(S),readmeCommand=BLOCK))
# Exact README curl acquisition and digest, independent of npm.
url=re.search(r'--package=(\S+)',BLOCK)[1]
a=subprocess.run(['curl','--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--connect-timeout','10','--max-time','30','--output',str(S/'received.tgz'),url],capture_output=True,timeout=35)
assert a.returncode==0,a.stderr
b=(S/'received.tgz').read_bytes();assert len(b)==18633 and hashlib.sha256(b).hexdigest()==SHA
rows=[];maximum=0
for mode in ['normal-eof','abrupt-close','recovery-1','initialized-client-term','recovery-2','startup-client-term','recovery-3','pending-close','recovery-4','pending-client-term','recovery-5','npm-term','recovery-6']:
    p=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'client',mode,str(S),BLOCK],start_new_session=True,stdout=open(S/(mode+'.stdout'),'w'),stderr=open(S/(mode+'.client-stderr'),'w'))
    observed={};history=[];sent=False;start=time.monotonic();exitedAt=None;signalSnapshot=None
    while time.monotonic()-start<40:
        sample=descendants(os.getpid());maximum=max(maximum,sum(x['rssKiB'] for x in sample)+(ident(os.getpid()) or {}).get('rssKiB',0))
        for x in sample:
            k=(x['pid'],x['startTicks'])
            if k not in observed:observed[k]=x;history.append(dict(elapsed=round(time.monotonic()-start,3),**x))
        ep=S/(mode+'.events.jsonl');events=[json.loads(x) for x in ep.read_text().splitlines()] if ep.exists() else []
        if not sent and any(x.get('readyForSignal') for x in events):p.send_signal(signal.SIGTERM);sent=True
        if signalSnapshot is None and any(x.get('signalNpm') and time.monotonic()-x['at']>.5 for x in events):signalSnapshot=sample
        if p.poll() is not None:
            exitedAt=exitedAt or time.monotonic()
            alive=[ident(pid) for pid,t in observed if pid!=p.pid and ident(pid) and ident(pid)['startTicks']==t]
            if not alive or time.monotonic()-exitedAt>2:break
        time.sleep(.01)
    before=[i for (pid,t) in observed if (i:=ident(pid)) and i['startTicks']==t]
    actions=[]
    # Explicit containment only after result captured. Never target unseen PIDs.
    for sig in [signal.SIGTERM,signal.SIGKILL]:
        for x in before:
            i=ident(x['pid'])
            if i and i['startTicks']==x['startTicks'] and i['state']!='Z':
                os.kill(x['pid'],sig);actions.append(dict(pid=x['pid'],signal=sig.name))
        time.sleep(.1)
    p.wait()
    reaped=[]
    while True:
        try:
            pid,status=os.waitpid(-1,os.WNOHANG)
            if not pid:break
            reaped.append(dict(pid=pid,exit=os.waitstatus_to_exitcode(status)))
        except ChildProcessError:break
    after=[i for (pid,t) in observed if (i:=ident(pid)) and i['startTicks']==t]
    row=dict(mode=mode,halfSecondAfterNpmSignal=signalSnapshot,clientExit=p.returncode,clientSignalSent=sent,events=events,firstIdentities=history,beforeContainment=before,containmentSignals=actions,adoptedReaped=reaped,afterContainment=after,elapsed=round(time.monotonic()-start,3),clientStderr=(S/(mode+'.client-stderr')).read_text(),serverStderr=(S/(mode+'.stderr')).read_text())
    rows.append(row);dump(O/'ARCHIVE-CASES.json',dict(archiveSha256=SHA,archiveBytes=len(b),scratch=str(S),readmeCommand=BLOCK,sampledMaximumReceiverDescendantsKiB=maximum,sampleMs=10,cases=rows))
    print(json.dumps(dict(mode=mode,exit=p.returncode,before=[(x['pid'],x['state'],x['command']) for x in before],signals=actions,after=after)),flush=True)
    assert not after
