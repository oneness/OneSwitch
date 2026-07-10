# OneSwitch GNOME Port — Phase 3: Command Mode & Shell History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing `>` switches the popup into command mode: matching shell-history commands appear for selection; Enter runs the selected one, Ctrl+J runs exactly what is typed (`bash -lc`); output (stdout+stderr, exit code) shows in the popup and is copied to the clipboard; Esc kills a running command.

**Architecture:** Pure parsing modules — `query.js` (detect `>`-mode) and `history.js` parse/match (over file *content*, no IO) — are Node-tested. `history.js` also gets a thin `Gio` file reader, and `command.js` runs the subprocess via `Gio.Subprocess` + copies output with `St.Clipboard`. `switcher.js` branches on mode to show history rows or run + display output.

**Tech Stack:** GJS, `Gio.Subprocess`, `St.Clipboard`, `GLib` env, Node `node --test` for pure parsing.

**Prerequisite:** Phases 1–2 complete.

---

## File Structure (Phase 3)

```
gnome/oneswitch@oneness.health/lib/
  query.js         # NEW  PURE parseQuery(text) -> {mode, value}
  history.js       # NEW  PURE parseHistory/matchHistory + Gio readHistory()
  command.js       # NEW  CommandRunner: Gio.Subprocess + clipboard
  switcher.js      # MOD  command-mode UI: history rows, run, output, Esc-kill
gnome/test/
  query.test.js    # NEW  node --test
  history.test.js  # NEW  node --test
```

Command-mode item shape: `{ id, kind:'cmd', title /*=command*/, appName:'' }`.

---

### Task 1: `query.js` — detect `>` command mode (PURE, TDD)

**Files:**
- Create: `gnome/oneswitch@oneness.health/lib/query.js`
- Test: `gnome/test/query.test.js`

- [ ] **Step 1: Write the failing test**

`gnome/test/query.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../oneswitch@oneness.health/lib/query.js';

test('plain text is search mode', () => {
  assert.deepEqual(parseQuery('firefox'), { mode: 'search', value: 'firefox' });
});

test('leading > is command mode, > stripped and left-trimmed', () => {
  assert.deepEqual(parseQuery('>  ls -la'), { mode: 'command', value: 'ls -la' });
});

test('bare > is command mode with empty value', () => {
  assert.deepEqual(parseQuery('>'), { mode: 'command', value: '' });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd gnome && node --test test/query.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `query.js`**

`gnome/oneswitch@oneness.health/lib/query.js`:

```js
// Pure. Detect command mode ("> …") vs search mode.
export function parseQuery(text) {
  const t = text || '';
  if (t.startsWith('>')) return { mode: 'command', value: t.slice(1).replace(/^\s+/, '') };
  return { mode: 'search', value: t };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd gnome && node --test test/query.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/query.js gnome/test/query.test.js
git commit -m "feat(gnome): pure command-mode query parsing"
```

---

### Task 2: `history.js` — parse + match shell history (PURE, TDD)

**Files:**
- Create: `gnome/oneswitch@oneness.health/lib/history.js`
- Test: `gnome/test/history.test.js`

- [ ] **Step 1: Write the failing test**

`gnome/test/history.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHistory, matchHistory } from '../oneswitch@oneness.health/lib/history.js';

test('bash history: most-recent-first, de-duped, blanks dropped', () => {
  const content = 'ls\n\ncd /tmp\nls\n';
  assert.deepEqual(parseHistory(content, 'bash'), ['ls', 'cd /tmp']);
});

test('zsh extended-history timestamps are stripped', () => {
  const content = ': 1700000000:0;git status\n: 1700000005:0;git log\n';
  assert.deepEqual(parseHistory(content, 'zsh'), ['git log', 'git status']);
});

test('matchHistory filters case-insensitively by substring', () => {
  const entries = ['git status', 'git log', 'ls -la'];
  assert.deepEqual(matchHistory(entries, 'GIT'), ['git status', 'git log']);
});

test('matchHistory with empty fragment returns all entries', () => {
  const entries = ['a', 'b'];
  assert.deepEqual(matchHistory(entries, ''), ['a', 'b']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd gnome && node --test test/history.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure functions**

`gnome/oneswitch@oneness.health/lib/history.js`:

```js
// Pure parsing/matching. The Gio file reader lives at the bottom (Shell-only).

export function parseHistory(content, shell) {
  let lines = (content || '').split('\n');
  if (shell === 'zsh') lines = lines.map(l => l.replace(/^: \d+:\d+;/, ''));
  const seen = new Set();
  const out = [];
  for (let i = lines.length - 1; i >= 0; i--) {  // most-recent first
    const c = lines[i].trim();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

export function matchHistory(entries, fragment) {
  const f = (fragment || '').trim().toLowerCase();
  if (!f) return entries.slice();
  return entries.filter(e => e.toLowerCase().includes(f));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd gnome && node --test test/history.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/history.js gnome/test/history.test.js
git commit -m "feat(gnome): pure shell-history parse + match"
```

---

### Task 3: `history.js` — Gio file reader (Shell API)

**Files:**
- Modify: `gnome/oneswitch@oneness.health/lib/history.js`

- [ ] **Step 1: Append the reader**

Append to `gnome/oneswitch@oneness.health/lib/history.js`:

```js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// Read the user's shell history file, parsed most-recent-first + de-duped.
// Chooses zsh vs bash from $SHELL; returns [] if the file is unreadable.
export function readHistory() {
  const shellPath = GLib.getenv('SHELL') || '';
  const isZsh = shellPath.endsWith('zsh');
  const home = GLib.get_home_dir();
  const path = isZsh ? `${home}/.zsh_history` : `${home}/.bash_history`;
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) return [];
    const content = new TextDecoder('utf-8').decode(bytes);
    return parseHistory(content, isZsh ? 'zsh' : 'bash');
  } catch (_e) {
    return [];
  }
}
```

- [ ] **Step 2: Confirm the pure tests still pass (reader is additive)**

Run: `cd gnome && node --test test/history.test.js`
Expected: PASS — Node never imports `readHistory`, so the `gi://` import is not evaluated by the tests (they import the named pure functions, and the file's top-level still parses; if Node errors on the `gi://` import line, move `readHistory` + its imports into a separate `history-io.js` and re-point Task 4). 

> Note: in practice Node will try to evaluate the `import 'gi://GLib'` at module load and fail. To keep the pure tests green, put the reader in its own file instead: create `gnome/oneswitch@oneness.health/lib/history-io.js` containing the `GLib`/`Gio` imports + `readHistory` (which imports `parseHistory` from `./history.js`). Use `history-io.js` wherever `readHistory` is needed. Do this now rather than appending to `history.js`.

- [ ] **Step 3: Create `history-io.js` (the correct placement)**

`gnome/oneswitch@oneness.health/lib/history-io.js`:

```js
import GLib from 'gi://GLib';
import { parseHistory } from './history.js';

export function readHistory() {
  const shellPath = GLib.getenv('SHELL') || '';
  const isZsh = shellPath.endsWith('zsh');
  const home = GLib.get_home_dir();
  const path = isZsh ? `${home}/.zsh_history` : `${home}/.bash_history`;
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) return [];
    const content = new TextDecoder('utf-8').decode(bytes);
    return parseHistory(content, isZsh ? 'zsh' : 'bash');
  } catch (_e) {
    return [];
  }
}
```

If you appended the reader to `history.js` in Step 1, remove it from there now so `history.js` stays pure.

- [ ] **Step 4: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/history-io.js gnome/oneswitch@oneness.health/lib/history.js
git commit -m "feat(gnome): shell-history file reader (kept separate from pure parse)"
```

---

### Task 4: `command.js` — subprocess runner + clipboard (Shell API)

**Files:**
- Create: `gnome/oneswitch@oneness.health/lib/command.js`

- [ ] **Step 1: Write `command.js`**

`gnome/oneswitch@oneness.health/lib/command.js`:

```js
import Gio from 'gi://Gio';
import St from 'gi://St';

// Runs one shell command at a time via `bash -lc`. Captures stdout+stderr and
// the exit code, copies the combined output to the clipboard, and reports via
// the onDone callback. cancel() kills a running command (for Esc).
export class CommandRunner {
  constructor() { this._proc = null; }

  run(cmd, onDone) {
    this.cancel();
    let proc;
    try {
      proc = Gio.Subprocess.new(
        ['bash', '-lc', cmd],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    } catch (e) {
      onDone({ output: `failed to start: ${e}`, code: -1 });
      return;
    }
    this._proc = proc;
    proc.communicate_utf8_async(null, null, (p, res) => {
      let output, code;
      try {
        const [, stdout, stderr] = p.communicate_utf8_finish(res);
        output = (stdout || '') + (stderr || '');
        code = p.get_exit_status();
      } catch (e) {
        output = String(e);
        code = -1;
      }
      this._proc = null;
      St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, output);
      onDone({ output, code });
    });
  }

  cancel() {
    if (this._proc) {
      try { this._proc.force_exit(); } catch (_e) {}
      this._proc = null;
    }
  }
}
```

- [ ] **Step 2: Syntax-check with gjs**

Run: `gjs -c "import('./gnome/oneswitch@oneness.health/lib/command.js').then(()=>print('ok')).catch(e=>printerr(e))"`
Expected: `ok` (this module has no runtime-only globals, so it should fully load).

- [ ] **Step 3: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/command.js
git commit -m "feat(gnome): command-mode subprocess runner + clipboard copy"
```

---

### Task 5: `switcher.js` — command-mode UI (rows, run, output, Esc-kill)

**Files:**
- Modify: `gnome/oneswitch@oneness.health/lib/switcher.js`

- [ ] **Step 1: Add imports + an output label + a runner**

Add imports near the top of `switcher.js`:

```js
import { parseQuery } from './query.js';
import { matchHistory } from './history.js';
import { readHistory } from './history-io.js';
import { CommandRunner } from './command.js';
```

In `_init()`, after building `this._scroll`/`this._list`, add an output area and runner:

```js
    this._output = new St.Label({ style_class: 'oneswitch-output', text: '' });
    this._output.clutter_text.line_wrap = true;
    this._output.visible = false;
    this._box.add_child(this._output);

    this._runner = new CommandRunner();
    this._mode = 'search';
    this._history = [];
```

- [ ] **Step 2: Load history on open + reset output**

In `open()`, after `this._apps = Apps.listApps(...)`, add:

```js
    this._history = readHistory();
    this._output.visible = false;
    this._output.set_text('');
    this._mode = 'search';
```

- [ ] **Step 3: Branch `_refilter()` on mode**

Replace `_refilter()` with:

```js
  _refilter() {
    const parsed = parseQuery(this._entry.get_text());
    this._mode = parsed.mode;
    if (parsed.mode === 'command') {
      this._items = matchHistory(this._history, parsed.value)
        .map((c, i) => ({ id: `cmd-${i}`, kind: 'cmd', title: c, appName: '' }));
    } else {
      this._items = composeResults(this._all, this._apps, parsed.value);
    }
    this._selected = 0;
    this._render();
  }
```

- [ ] **Step 4: Run a command + show output (replace `_activateIndex`)**

Replace `_activateIndex()` with:

```js
  _activateIndex(i) {
    const it = this._items[i];
    if (this._mode === 'command') {
      const cmd = it ? it.title : '';
      if (cmd) this._runCommand(cmd);
      return; // stay open to show output
    }
    this.close();
    if (!it) return;
    if (it.kind === 'app') Apps.launch(it.appInfo);
    else Windows.activate(it.metaWindow);
  }

  _runCommand(cmd) {
    this._output.visible = true;
    this._output.set_text('running…');
    this._runner.run(cmd, ({ output, code }) => {
      this._output.set_text(`$ ${cmd}\n${output}\n[exit ${code}] (copied to clipboard)`);
    });
  }
```

- [ ] **Step 5: Ctrl+J runs typed command; Esc kills then closes**

In `_onKey(ev)`, add Ctrl+J handling near the top (after computing `ctrl`):

```js
    if (ctrl && sym === Clutter.KEY_j) {
      const parsed = parseQuery(this._entry.get_text());
      if (parsed.mode === 'command' && parsed.value) this._runCommand(parsed.value);
      return Clutter.EVENT_STOP;
    }
```

Replace the existing Escape line so Esc first cancels a running command:

```js
    if (sym === Clutter.KEY_Escape) {
      if (this._runner) this._runner.cancel();
      this.close();
      return Clutter.EVENT_STOP;
    }
```

In `close()`, also cancel any running command — add at the top of `close()`:

```js
    if (this._runner) this._runner.cancel();
```

- [ ] **Step 6: Style the output area**

Append to `gnome/oneswitch@oneness.health/stylesheet.css`:

```css
.oneswitch-output {
  font-family: monospace;
  font-size: 12px;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background-color: rgba(0, 0, 0, 0.35);
  color: rgba(255, 255, 255, 0.9);
}
```

- [ ] **Step 7: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/switcher.js gnome/oneswitch@oneness.health/stylesheet.css
git commit -m "feat(gnome): command mode UI — history rows, run, output, Esc-kill"
```

---

### Task 6: Nested-shell acceptance

**Files:** none.

- [ ] **Step 1: Reinstall + run**

Run: `cd gnome && make test && make install && make nested`
Then: `gnome-extensions enable oneswitch@oneness.health`

- [ ] **Step 2: Verify**

- Typing `>` switches to command mode; matching `~/.bash_history` / `~/.zsh_history` entries list.
- Enter on a history row runs it; output (stdout+stderr) + `[exit N]` shows in the popup and is on the clipboard (paste to confirm).
- `> sleep 5` then **Ctrl+J** starts it; **Esc** kills it and closes.
- Removing the `>` returns to the normal window/app search (Phases 1–2 unaffected).

Expected: all pass.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A gnome/
git commit -m "fix(gnome): Phase 3 command-mode acceptance fixes"
```

---

## Self-Review

**Spec coverage (Phase 3 slice):** `>`-prefix command mode → Task 1 ✅; shell-history picker → Tasks 2–3 + Task 5 Step 3 ✅; Enter runs selected, Ctrl+J runs typed → Task 5 Steps 4–5 ✅; output shown + copied to clipboard → Task 4 + Task 5 Step 4 ✅; Esc kills running command → Task 5 Step 5 ✅; no-TTY `bash -lc` semantics → Task 4 ✅.

**Placeholder scan:** none. The history-reader placement caveat (Task 3) is resolved with concrete code (`history-io.js`), keeping `history.js` pure for Node.

**Type consistency:** `parseQuery` returns `{mode, value}` (Task 1), consumed in `_refilter`/`_onKey` (Task 5). `matchHistory(entries, fragment)` (Task 2) called with `(this._history, parsed.value)` (Task 5 Step 3). `readHistory()` (Task 3) returns `string[]` assigned to `this._history` (Task 5 Step 2). `CommandRunner.run(cmd, onDone)` with `onDone({output, code})` (Task 4) matches `_runCommand` (Task 5 Step 4). cmd item shape `{kind:'cmd', title}` produced in `_refilter` and read in `_activateIndex`. ✅
