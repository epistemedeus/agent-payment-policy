#!/usr/bin/env python3
"""Linux test launcher: deny network syscalls in this process and every descendant."""
import ctypes
import ctypes.util
import errno
import os
import sys

lib = ctypes.CDLL(ctypes.util.find_library('seccomp'), use_errno=True)
lib.seccomp_init.argtypes = [ctypes.c_uint32]
lib.seccomp_init.restype = ctypes.c_void_p
lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
class Compare(ctypes.Structure):
    _fields_ = [('arg', ctypes.c_uint), ('op', ctypes.c_int), ('a', ctypes.c_uint64), ('b', ctypes.c_uint64)]
lib.seccomp_rule_add_array.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint, ctypes.POINTER(Compare)]
lib.seccomp_load.argtypes = [ctypes.c_void_p]
lib.seccomp_release.argtypes = [ctypes.c_void_p]
ctx = lib.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW
if not ctx:
    raise RuntimeError('seccomp unavailable')
# AF_UNIX socketpairs are Node's local subprocess stdio carrier. Preserve them.
for name in ['socket', 'socketpair']:
    cmp = Compare(0, 1, 1, 0)  # argument 0 != AF_UNIX
    if lib.seccomp_rule_add_array(ctx, 0x00050000 | errno.EPERM, lib.seccomp_syscall_resolve_name(name.encode()), 1, ctypes.byref(cmp)) != 0:
        raise RuntimeError('seccomp domain rule failed')
for name in ['connect', 'bind', 'listen', 'accept', 'accept4']:
    call = lib.seccomp_syscall_resolve_name(name.encode())
    if call >= 0 and lib.seccomp_rule_add(ctx, 0x00050000 | errno.EPERM, call, 0) != 0:
        raise RuntimeError('seccomp rule failed')
if lib.seccomp_load(ctx) != 0:
    raise RuntimeError('seccomp load failed')
lib.seccomp_release(ctx)
os.execvp(sys.argv[1], sys.argv[1:])
