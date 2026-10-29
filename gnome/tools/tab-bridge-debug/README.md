# Tab bridge debug kit

Diagnostics for the browser-tab hop of OneSwitch for GNOME. Two jobs:

1. **An open bug**: Firefox sometimes lists only a few of its tabs, and only a
   Firefox restart brings the rest back — usually after Firefox has been running
   for a while. Not yet reproduced under instrumentation; the tools here are how
   it gets caught next time.
2. Any future "the switcher's tab list is wrong" report.

Nothing here ships in the app. The instrumentation it relies on is in the code
and marked `Remove this block … when the bug is closed`.

## How a tab reaches the switcher

```
Firefox webext            native host                   GNOME Shell
background.js  ──stdio──► oneswitch-browser.js  ──unix socket──► lib/browser.js
```

- `gnome/webext/background.js` opens a native-messaging port and **pushes the
  whole tab list** on `tabs.onCreated/onRemoved/onActivated/onUpdated` and
  `windows.onFocusChanged`. It is event-driven: an idle browser pushes nothing.
- `gnome/native-host/oneswitch-browser.js` (GJS) keeps the last snapshot in
  memory and answers `{cmd:'list'}` on
  `$XDG_RUNTIME_DIR/oneswitch-browser-firefox.sock`. It is a **pure cache** — it
  never asks the browser for anything.
- `gnome/oneswitch@birkey.co/lib/browser.js` reads that socket once per popup
  open.

The consequence that matters: **one lost, late or partial push leaves a short
list on screen until some other tab event triggers a fresh push.** Nothing
refreshes it on a timer, which is why the symptom can persist for hours and why
a browser restart (new host, fresh push) fixes it.

Known ways that happens, and what each looks like in the log:

| Symptom | Cause |
| --- | --- |
| Heartbeats continue, `lastPushAge` grows, count frozen | The browser stopped pushing: port died without `onDisconnect`, an event listener threw, or `tabs.query` never resolved |
| `WARN … tab count dropped N -> M on <trigger>` where the trigger is not `tabs.onRemoved` | A slower, older `tabs.query` reply overwrote a newer, larger one |
| `FATAL pump`, `stdin: EOF`, or a gap in heartbeats | The host stopped reading or exited: the socket then serves a frozen list, or nothing |
| Popup is short but there is **no** `serve list` line at that time | The Shell never reached the host (stale socket file, or two hosts fighting over the path) |
| `socket: removed a pre-existing socket file` | A previous host was killed without unlinking (normal after a Firefox restart), or a second host is alive |

## Deploy

```sh
gnome/tools/tab-bridge-debug/install.sh     # per-user manifest -> this checkout's host
```

Then restart Firefox. The per-user manifest shadows the NixOS system one, so no
rebuild is needed; `install.sh remove` undoes it. The webext needs no install if
you are running the checkout's build; otherwise re-zip
`gnome/webext/{manifest.json,background.js}` over the profile's
`extensions/oneswitch@birkey.co.xpi` and restart Firefox.

Shell-side logging additionally needs the extension reloaded — on Wayland that
means a **session restart** (log out/in). A disable/enable cycle does *not*
re-import the module: the ES module cache lasts for the session.

Verify it armed:

```sh
# the running host is ours (ps truncates long argv, so filter on the process name)
for p in /proc/[0-9]*; do [ "$(cat $p/comm 2>/dev/null)" = gjs ] &&
  tr '\0' ' ' < $p/cmdline | grep -q oneswitch-browser.js &&
  echo "${p#/proc/}: $(tr '\0' ' ' < $p/cmdline)"; done

# the socket answers, with the diagnostic fields
gnome/tools/tab-bridge-debug/probe.py
```

## When it happens again

```sh
gnome/tools/tab-bridge-debug/probe.py    # ground truth: snapshot vs Firefox's session store
gnome/tools/tab-bridge-debug/report.py   # timeline + verdict for the log
journalctl --user -b | grep "OneSwitch] browser:"   # Shell side, after a session restart
```

`probe.py` is the one that decides whether there is a bug at all: it decodes
Firefox's own `recovery.jsonlz4` (it finds the running profile via its `lock`
symlink) and lists the tabs the snapshot is missing. Exit code 1 = short.

Raw log: `$XDG_RUNTIME_DIR/oneswitch-host-firefox.log`, appended across host
restarts and rotated at 8 MiB. Both ends write to it — the host directly, the
webext by relaying its own lines through the native port — so one file shows the
whole timeline even when the pipe itself is the problem.

Two readings that look alarming but are not: a large `lastPushAge` (pushes only
happen on tab events), and a drop to a lower tab count (you closed a tab — only
a drop on a non-`tabs.onRemoved` trigger is suspicious).

## Notes for the next person

- Two hosts on one socket path is a real failure mode: each host `unlink`s the
  path on start *and* on exit, so a quick Firefox restart can let the outgoing
  host delete the incoming host's socket, and a second browser profile can steal
  it. `probe.py` returning "no socket" while a host is alive is that race.
- The host infers the browser from `argv[0]`; a per-user manifest path has no
  "firefox" in it, which is why `dev-host.sh` injects the marker.
- Do not grep `ps` for `oneswitch-browser.js`: the argument is truncated, and a
  shell running that grep matches its own command line. Filter on `comm = gjs`.
