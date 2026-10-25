#!/usr/bin/env python3
"""Finite npm stdio launcher that owns and reaps npm's shell descendants on close."""
import ctypes
import os
import signal
import subprocess
import sys
import time

libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
    raise RuntimeError('cannot enable scoped child reaping')
child = subprocess.Popen(sys.argv[1:], start_new_session=True)
closing = None
def close(signum, _frame):
    global closing
    closing = closing or time.monotonic()
    try:
        os.killpg(child.pid, signum)
    except ProcessLookupError:
        pass
for sig in [signal.SIGTERM, signal.SIGINT]:
    signal.signal(sig, close)
code = None
while True:
    try:
        pid, status = os.waitpid(-1, os.WNOHANG)
    except ChildProcessError:
        break
    if pid == child.pid:
        code = os.waitstatus_to_exitcode(status)
        closing = closing or time.monotonic()
        # Reap shells/servers even if npm exited before its descendants.
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    if closing and time.monotonic() - closing > 0.5:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if not pid:
        time.sleep(0.01)
sys.exit(0 if code is None or code < 0 else code)
