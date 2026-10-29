#!/usr/bin/env python3
"""Summarise the OneSwitch browser-bridge debug log.

Reads $XDG_RUNTIME_DIR/oneswitch-host-<browser>.log and prints a verdict aimed
at one question: when the popup shows fewer tabs than Firefox has, which hop
lost them — the webext's push, the host's cache, or the socket the Shell read?

    gnome/tools/tab-bridge-debug/report.py            # firefox, last 40 events
    gnome/tools/tab-bridge-debug/report.py chrome
"""
import os
import re
import sys
from datetime import datetime, timedelta

browser = sys.argv[1] if len(sys.argv) > 1 else 'firefox'
tail_n = int(sys.argv[2]) if len(sys.argv) > 2 else 40
path = os.path.join(os.environ.get('XDG_RUNTIME_DIR', '/run/user/%d' % os.getuid()),
                    'oneswitch-host-%s.log' % browser)

LINE = re.compile(r'^(\S+) \[(\w+)\] (.*)$')
TS = '%Y-%m-%dT%H:%M:%S.%fZ'


def parse(line):
    m = LINE.match(line.rstrip('\n'))
    if not m:
        return None
    try:
        t = datetime.strptime(m.group(1), TS)
    except ValueError:
        return None
    return t, m.group(2), m.group(3)


def num(pattern, text, default=None):
    m = re.search(pattern, text)
    return int(m.group(1)) if m else default


def main():
    if not os.path.exists(path):
        print('no log at %s\n'
              '  -> the debug host has never run: deploy the wrapper + manifest,\n'
              '     then restart the browser (see README in this directory)' % path)
        return 1

    events = [e for e in (parse(l) for l in open(path, errors='replace')) if e]
    if not events:
        print('log at %s has no parsable lines' % path)
        return 1

    starts = [e for e in events if e[2].startswith('start:')]
    pushes = [e for e in events if e[2].startswith('recv tabs#')]
    serves = [e for e in events if e[2].startswith('serve list:')]
    beats = [e for e in events if e[2].startswith('heartbeat:')]
    warns = [e for e in events if 'WARN' in e[2] or 'FATAL' in e[2]]

    print('log: %s' % path)
    print('span: %s .. %s (%d host start(s), %d pushes, %d popup reads)'
          % (events[0][0].strftime('%m-%d %H:%M:%S'), events[-1][0].strftime('%m-%d %H:%M:%S'),
             len(starts), len(pushes), len(serves)))

    # Biggest snapshot the browser ever pushed vs what the popup was served.
    if pushes:
        counts = [(e[0], num(r'(\d+) tab\(s\)', e[2], 0), e[2]) for e in pushes]
        peak_t, peak_n, _ = max(counts, key=lambda c: c[1])
        last_t, last_n, last_text = counts[-1]
        print('pushes: peak %d tabs at %s; last %d tabs at %s'
              % (peak_n, peak_t.strftime('%m-%d %H:%M:%S'), last_n,
                 last_t.strftime('%m-%d %H:%M:%S')))
        if last_n < peak_n:
            print('  note: last push had %d tab(s) vs a peak of %d — expected if you closed tabs;'
                  % (last_n, peak_n))
            print('        only suspicious if you did not (then suspect a stale query reply).')

    if serves:
        t, _, text = serves[-1]
        print('last popup read: %s served %s tab(s), %s, %s'
              % (t.strftime('%m-%d %H:%M:%S'), num(r'tabs=(\d+)', text, -1),
                 re.search(r'lastPushAge=(\S+)', text).group(1) if 'lastPushAge=' in text else 'age?',
                 re.search(r'pushes=(\d+)', text).group(1) if 'pushes=' in text else '?'))

    # Longest silence between consecutive pushes, ignoring host restarts.
    gaps = []
    for a, b in zip(pushes, pushes[1:]):
        if b[2].startswith('recv tabs#1'):
            continue
        gaps.append(((b[0] - a[0]).total_seconds(), a[0], b[0]))
    if gaps:
        worst, a_t, b_t = max(gaps)
        if worst > 300:
            print('biggest push gap: %.1f min (%s -> %s)'
                  % (worst / 60, a_t.strftime('%m-%d %H:%M:%S'), b_t.strftime('%m-%d %H:%M:%S')))
            live = [e for e in beats if a_t < e[0] < b_t]
            if live:
                print('  the host stayed alive through that gap (%d heartbeats) while the browser'
                      % len(live))
                print('  pushed nothing — normal while idle; a freeze only if you were using tabs.')
            else:
                print('  no heartbeats in that gap -> the host itself was not running or not reading.')

    if warns:
        print('warnings (%d), most recent first (a drop on tabs.onRemoved is a closed tab):'
              % len(warns))
        for t, _, text in warns[-8:][::-1]:
            print('  %s %s' % (t.strftime('%m-%d %H:%M:%S'), text))
    else:
        print('warnings: none')

    print('\nlast %d events:' % tail_n)
    for t, inst, text in events[-tail_n:]:
        print('  %s %s %s' % (t.strftime('%m-%d %H:%M:%S'), inst, text))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BrokenPipeError:      # e.g. piped into `head`
        sys.stderr.close()
        sys.exit(0)
