"""Positive control for the existing per-process no-egress guard."""
import errno
import json
import socket
for family in [socket.AF_INET, socket.AF_INET6]:
    try:
        socket.socket(family, socket.SOCK_STREAM)
    except OSError as e:
        assert e.errno == errno.EPERM
    else:
        raise AssertionError('Internet socket unexpectedly permitted')
print(json.dumps({'ok': True, 'AF_INET': 'EPERM', 'AF_INET6': 'EPERM',
                  'boundary': 'Inherited network syscall denial; AF_UNIX stdio preserved'}))
