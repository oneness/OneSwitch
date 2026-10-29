#!/usr/bin/env python3
"""Compare the snapshot the switcher would show with what Firefox actually has.

The bridge is a cache: the popup shows whatever the webext last pushed. So the
question "did the popup lose tabs, or does Firefox really only have this many?"
needs an independent count — Firefox's own session store, which it rewrites
every ~15 s.

    gnome/tools/tab-bridge-debug/probe.py            # firefox, auto-detect profile
    gnome/tools/tab-bridge-debug/probe.py firefox ~/.config/mozilla/firefox/xxx.dev-edition-default

Exit codes: 0 match, 1 mismatch, 2 could not measure.
"""
import glob
import json
import os
import re
import socket
import struct
import sys
import time


# --- Firefox session store (mozLz4 = magic + uint32 size + raw LZ4 block) ---
def lz4_block(src, out_size):
    dst = bytearray()
    i, n = 0, len(src)
    while i < n:
        token = src[i]; i += 1
        lit = token >> 4
        if lit == 15:
            while True:
                b = src[i]; i += 1
                lit += b
                if b != 255:
                    break
        dst += src[i:i + lit]; i += lit
        if i >= n:
            break
        offset = src[i] | (src[i + 1] << 8); i += 2
        if offset == 0:
            break
        mlen = token & 0xF
        if mlen == 15:
            while True:
                b = src[i]; i += 1
                mlen += b
                if b != 255:
                    break
        mlen += 4
        start = len(dst) - offset
        for k in range(mlen):
            dst.append(dst[start + k])
    if len(dst) != out_size:
        raise ValueError('lz4 size mismatch: %d != %d' % (len(dst), out_size))
    return bytes(dst)


def mozlz4(path):
    raw = open(path, 'rb').read()
    if raw[:8] != b'mozLz40\0':
        raise ValueError('not a mozLz4 file: %r' % raw[:8])
    return lz4_block(raw[12:], int.from_bytes(raw[8:12], 'little'))


def find_profile(explicit=None):
    """The profile Firefox is running, not merely the freshest one on disk.

    A profile's `lock` is a symlink to `<ip>:+<pid>`; if that pid is alive, that
    is the live profile. Falling back to mtime can pick a profile that has not
    been used in months and silently compare against a stale session.
    """
    if explicit:
        return explicit
    base = os.path.expanduser('~/.config/mozilla/firefox')
    for d in glob.glob(os.path.join(base, '*')):
        try:
            target = os.readlink(os.path.join(d, 'lock'))
        except OSError:
            continue
        m = re.search(r'\+(\d+)', target)
        if m and os.path.exists('/proc/' + m.group(1)):
            return d
    best = None
    for d in glob.glob(os.path.join(base, '*')):
        p = os.path.join(d, 'sessionstore-backups', 'recovery.jsonlz4')
        if os.path.exists(p) and (best is None or os.path.getmtime(p) > os.path.getmtime(best[1])):
            best = (d, p)
    if not best:
        raise SystemExit('no running Firefox profile and no sessionstore-backups; pass the profile dir')
    return best[0]


def firefox_tabs(profile):
    for name in ('recovery.jsonlz4', 'recovery.baklz4'):
        p = os.path.join(profile, 'sessionstore-backups', name)
        if os.path.exists(p):
            data = json.loads(mozlz4(p))
            tabs = []
            for w in data.get('windows', []):
                for t in w.get('tabs', []):
                    e = t.get('entries') or [{}]
                    cur = e[min(t.get('index', 1), len(e)) - 1]
                    tabs.append({'title': cur.get('title') or '', 'url': cur.get('url') or ''})
            return tabs, p, os.path.getmtime(p)
    raise SystemExit('no recovery file in %s' % profile)


# --- the bridge's socket ---
def bridge_tabs(browser):
    p = os.path.join(os.environ.get('XDG_RUNTIME_DIR', '/run/user/%d' % os.getuid()),
                     'oneswitch-browser-%s.sock' % browser)
    if not os.path.exists(p):
        raise SystemExit('no socket at %s (host not running?)' % p)
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(5)
    s.connect(p)
    s.sendall(b'{"cmd":"list"}\n')
    buf = b''
    while not buf.endswith(b'\n'):
        chunk = s.recv(1 << 20)
        if not chunk:
            break
        buf += chunk
    s.close()
    return json.loads(buf), p


def main():
    browser = sys.argv[1] if len(sys.argv) > 1 else 'firefox'
    profile = find_profile(sys.argv[2] if len(sys.argv) > 2 else None)

    resp, sock = bridge_tabs(browser)
    snap = resp.get('tabs') or []
    ts = resp.get('ts') or 0
    age = (time.time() * 1000 - ts) / 1000 if ts else -1

    ff, src, mtime = firefox_tabs(profile)
    live = 'yes' if time.time() - mtime < 60 else 'STALE (%.0fs old)' % (time.time() - mtime)

    print('bridge snapshot : %d tab(s) in %d window(s), %s, pushed %s ago, %s pushes'
          % (len(snap), len({t.get('windowId') for t in snap}), sock,
             '%.0fs' % age if age >= 0 else 'never', resp.get('pushes')))
    print('firefox session : %d tab(s) in %d window(s), from %s/%s (written %s)'
          % (len(ff), len({1}), os.path.basename(profile), os.path.basename(src), live))

    if len(snap) == len(ff):
        print('\nMATCH — the popup would list every tab Firefox has.')
        return 0

    print('\nMISMATCH — the popup is missing %d tab(s).' % abs(len(ff) - len(snap)))
    have = {(t.get('url') or '') for t in snap}
    missing = [t for t in ff if t['url'] not in have]
    if missing:
        print('in Firefox but not in the snapshot:')
        for t in missing[:25]:
            print('  %-58s %s' % (t['title'][:58], t['url'][:50]))
        if len(missing) > 25:
            print('  … and %d more' % (len(missing) - 25))
    else:
        print('(same URLs, different count — duplicate/ordering difference)')
    if age > 600:
        print('\nsnapshot is %.0f min old: the webext has not pushed since then, so the'
              % (age / 60))
        print('freeze is on the browser side — check the log for the last push and any'
              ' WARN/postMessage/query failures around it.')
    return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.stderr.close()
        sys.exit(0)
