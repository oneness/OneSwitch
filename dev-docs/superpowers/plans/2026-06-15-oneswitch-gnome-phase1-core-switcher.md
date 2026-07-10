# OneSwitch GNOME Port — Phase 1: Skeleton & Core Switcher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working GNOME 47 Shell extension that opens a centered modal popup on a global hotkey, lists open windows most-recently-used first with the *previous* window preselected, filters them with orderless fuzzy search, and activates the selected window on Enter.

**Architecture:** A single GJS Shell extension (GNOME 47 ESM). Pure, framework-free modules (`model.js`, `recency.js`) hold the search/ranking and preselect logic and are unit-tested with Node. Shell-integrated modules (`windows.js`, `switcher.js`, `extension.js`) wrap Mutter/St and are validated manually in a nested GNOME Shell. Later phases (launcher, command mode, browser tabs, packaging) build on this.

**Tech Stack:** GJS (ESM), GNOME Shell 47 (St/Clutter/Meta/Shell), GSettings, Node `node --test` for pure-module unit tests, a nested `gnome-shell --nested --wayland` for the dev loop.

---

## Conventions

- All Phase-1 work lives under `gnome/` in the repo (kept separate from the macOS Swift app at the repo root).
- Extension UUID: `oneswitch@oneness.health`. Extension dir: `gnome/oneswitch@oneness.health/`.
- Pure modules import **nothing** from `gi://` so Node can test them. Shell modules may import `gi://`.
- Each task ends with a commit. Use the exact `git add` paths shown.

## File Structure (Phase 1)

```
gnome/
  package.json                                  # {"type":"module"} so Node runs ESM
  README.md                                     # dev loop: nested shell, install, logs
  Makefile                                      # install/uninstall/test/nested targets
  oneswitch@oneness.health/
    metadata.json                               # uuid, shell-version ["47"], settings-schema
    extension.js                                # enable()/disable(): hotkey + popup wiring
    stylesheet.css                              # popup styling (St CSS subset)
    schemas/
      org.gnome.shell.extensions.oneswitch.gschema.xml   # hotkey key
    lib/
      model.js          # PURE: filterAndRank(items, query)
      recency.js        # PURE: preselectIndex(items, focusedId)
      windows.js        # Shell API: listWindows(), activate(metaWindow)
      switcher.js       # St modal popup: search entry, list, keynav, selection
  test/
    model.test.js       # node --test
    recency.test.js     # node --test
```

Responsibilities: `model.js` decides *what* shows and in what order; `recency.js` decides the initial selection; `windows.js` is the only file that knows Mutter window APIs; `switcher.js` is the only file that knows St/Clutter UI; `extension.js` only wires lifecycle. Keeping the Shell-API surface inside `windows.js`/`switcher.js` means a future GNOME version bump touches few files.

---

### Task 1: Repo scaffold + metadata + GSettings schema

**Files:**
- Create: `gnome/package.json`
- Create: `gnome/oneswitch@oneness.health/metadata.json`
- Create: `gnome/oneswitch@oneness.health/schemas/org.gnome.shell.extensions.oneswitch.gschema.xml`

- [ ] **Step 1: Create `gnome/package.json`**

```json
{
  "name": "oneswitch-gnome",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `metadata.json`**

```json
{
  "uuid": "oneswitch@oneness.health",
  "name": "OneSwitch",
  "description": "Spotlight-style window/tab switcher and launcher on a global hotkey.",
  "shell-version": ["47"],
  "settings-schema": "org.gnome.shell.extensions.oneswitch",
  "url": "https://github.com/oneness/OneSwitch"
}
```

- [ ] **Step 3: Create the GSettings schema**

`gnome/oneswitch@oneness.health/schemas/org.gnome.shell.extensions.oneswitch.gschema.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<schemalist>
  <schema id="org.gnome.shell.extensions.oneswitch"
          path="/org/gnome/shell/extensions/oneswitch/">
    <key name="hotkey" type="as">
      <default><![CDATA[['<Control>Tab']]]></default>
      <summary>Open/close the switcher</summary>
      <description>Global hotkey that toggles the OneSwitch popup.</description>
    </key>
  </schema>
</schemalist>
```

- [ ] **Step 4: Compile the schema and verify it succeeds**

Run: `glib-compile-schemas gnome/oneswitch@oneness.health/schemas/`
Expected: exit 0, a `gschemas.compiled` file appears in that directory. (This compiled file is a build artifact — add `gnome/**/gschemas.compiled` to `.gitignore` in Step 5.)

- [ ] **Step 5: Commit**

```bash
echo "gnome/**/gschemas.compiled" >> .gitignore
git add gnome/package.json gnome/oneswitch@oneness.health/metadata.json \
  gnome/oneswitch@oneness.health/schemas/org.gnome.shell.extensions.oneswitch.gschema.xml .gitignore
git commit -m "feat(gnome): scaffold extension metadata + hotkey schema"
```

---

### Task 2: `model.js` — orderless fuzzy search + ranking (PURE, TDD)

**Files:**
- Create: `gnome/oneswitch@oneness.health/lib/model.js`
- Test: `gnome/test/model.test.js`

The item shape used everywhere in Phase 1: `{ id, title, appName, windowId, metaWindow }`. `model.js` only reads `title` and `appName`.

- [ ] **Step 1: Write the failing test**

`gnome/test/model.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAndRank } from '../oneswitch@oneness.health/lib/model.js';

const items = [
  { id: 1, title: 'Inbox — Gmail', appName: 'Firefox' },
  { id: 2, title: 'oneswitch — model.js', appName: 'Code' },
  { id: 3, title: 'Slack | general', appName: 'Slack' },
  { id: 4, title: 'OneSwitch design', appName: 'Notion' },
];

test('empty query returns all items unchanged', () => {
  assert.deepEqual(filterAndRank(items, '').map(i => i.id), [1, 2, 3, 4]);
});

test('tokens are orderless and ANDed across title + appName', () => {
  // "code one" must match item 2 (title has "one...", appName "Code")
  const r = filterAndRank(items, 'code one').map(i => i.id);
  assert.deepEqual(r, [2]);
});

test('non-matching token excludes the item', () => {
  assert.deepEqual(filterAndRank(items, 'slack gmail').map(i => i.id), []);
});

test('title matches outrank app-only matches', () => {
  // query "one" appears in titles of 2 and 4, and nowhere in appName.
  const r = filterAndRank(items, 'one').map(i => i.id);
  assert.deepEqual(r.slice(0, 2).sort(), [2, 4]);
});

test('shorter title breaks ties', () => {
  const tie = [
    { id: 'a', title: 'note', appName: 'X' },
    { id: 'b', title: 'note taking longer', appName: 'X' },
  ];
  assert.deepEqual(filterAndRank(tie, 'note').map(i => i.id), ['a', 'b']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gnome && node --test test/model.test.js`
Expected: FAIL — `Cannot find module '.../lib/model.js'`.

- [ ] **Step 3: Write the minimal implementation**

`gnome/oneswitch@oneness.health/lib/model.js`:

```js
// Pure search/ranking. No GNOME imports so Node can unit-test it.

function scoreItem(title, appName, tokens) {
  let score = 0;
  for (const t of tokens) {
    const inTitle = title.includes(t);
    const inApp = appName.includes(t);
    if (inTitle) score += 10;
    else if (inApp) score += 4;          // app-only match worth less than title
    if (title.startsWith(t)) score += 6; // prefix
    if (new RegExp(`\\b${escapeRe(t)}`).test(title)) score += 3; // word boundary
  }
  return score;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function filterAndRank(items, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return items.slice();
  const tokens = q.split(/\s+/);
  const scored = [];
  for (const it of items) {
    const title = (it.title || '').toLowerCase();
    const app = (it.appName || '').toLowerCase();
    const hay = `${title} ${app}`;
    if (!tokens.every(t => hay.includes(t))) continue;
    scored.push({ item: it, score: scoreItem(title, app, tokens) });
  }
  scored.sort((a, b) =>
    b.score - a.score ||
    (a.item.title || '').length - (b.item.title || '').length);
  return scored.map(s => s.item);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd gnome && node --test test/model.test.js`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/model.js gnome/test/model.test.js
git commit -m "feat(gnome): pure orderless fuzzy search + ranking"
```

---

### Task 3: `recency.js` — previous-window preselect (PURE, TDD)

**Files:**
- Create: `gnome/oneswitch@oneness.health/lib/recency.js`
- Test: `gnome/test/recency.test.js`

Mutter returns windows in MRU order, so index 0 is normally the *currently focused* window. The macOS app preselects the *previous* window so "hotkey, Enter" bounces between your two most recent windows. `preselectIndex` returns the first item whose `windowId` differs from the focused window's id.

- [ ] **Step 1: Write the failing test**

`gnome/test/recency.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preselectIndex } from '../oneswitch@oneness.health/lib/recency.js';

test('skips the focused window, selecting the next most-recent', () => {
  const items = [
    { windowId: 100 }, // focused, MRU[0]
    { windowId: 200 }, // previous window -> should be preselected
    { windowId: 300 },
  ];
  assert.equal(preselectIndex(items, 100), 1);
});

test('skips multiple leading rows that belong to the focused window', () => {
  // e.g. the focused window contributes several rows (future: its tabs)
  const items = [
    { windowId: 100 },
    { windowId: 100 },
    { windowId: 200 }, // first non-focused
  ];
  assert.equal(preselectIndex(items, 100), 2);
});

test('falls back to 0 when every row is the focused window', () => {
  assert.equal(preselectIndex([{ windowId: 100 }], 100), 0);
});

test('falls back to 0 on empty input', () => {
  assert.equal(preselectIndex([], 100), 0);
});

test('returns 0 when focusedId is null (no focused window)', () => {
  const items = [{ windowId: 200 }, { windowId: 300 }];
  assert.equal(preselectIndex(items, null), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gnome && node --test test/recency.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

`gnome/oneswitch@oneness.health/lib/recency.js`:

```js
// Pure. Given MRU-ordered items and the focused window id, pick the initial
// selection: the previous (next most-recent) window. Falls back to 0.

export function preselectIndex(items, focusedId) {
  if (!items || items.length === 0) return 0;
  if (focusedId === null || focusedId === undefined) return 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].windowId !== focusedId) return i;
  }
  return 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd gnome && node --test test/recency.test.js`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/recency.js gnome/test/recency.test.js
git commit -m "feat(gnome): pure previous-window preselect logic"
```

---

### Task 4: `windows.js` — Mutter window enumeration + activation (Shell API)

**Files:**
- Create: `gnome/oneswitch@oneness.health/lib/windows.js`

This file is the only place that touches Mutter window APIs. It cannot be Node-tested; it is verified in Task 7's nested-shell acceptance run. Keep it tiny.

- [ ] **Step 1: Write the implementation**

`gnome/oneswitch@oneness.health/lib/windows.js`:

```js
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Return open normal windows in MRU order as Phase-1 item objects.
export function listWindows() {
  const tracker = Shell.WindowTracker.get_default();
  const wins = global.display.get_tab_list(Meta.TabList.NORMAL, null);
  const items = [];
  for (const w of wins) {
    if (w.get_window_type() !== Meta.WindowType.NORMAL) continue;
    if (w.is_skip_taskbar()) continue;
    const app = tracker.get_window_app(w);
    items.push({
      id: `win-${w.get_id()}`,
      title: w.get_title() || '',
      appName: app ? app.get_name() : '',
      windowId: w.get_id(),
      metaWindow: w,
      app, // Shell.App | null, used later for the row icon
    });
  }
  return items;
}

// Id of the currently focused window, or null.
export function focusedWindowId() {
  const w = global.display.get_focus_window();
  return w ? w.get_id() : null;
}

// Raise + focus a window.
export function activate(metaWindow) {
  Main.activateWindow(metaWindow);
}
```

- [ ] **Step 2: Syntax-check the file with gjs**

Run: `gjs -c "import('./gnome/oneswitch@oneness.health/lib/windows.js').then(()=>print('ok')).catch(e=>{printerr(e); imports.system.exit(1)})"`
Expected: This will FAIL at runtime outside the Shell (the `resource:///` and `global` symbols only exist inside `gnome-shell`). That is expected — this step is only to catch **syntax** errors. If the error mentions `global is not defined` or `resource://… not found`, syntax is fine; if it reports a `SyntaxError`, fix it. Real verification happens in Task 7.

- [ ] **Step 3: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/windows.js
git commit -m "feat(gnome): Mutter window enumeration + activation"
```

---

### Task 5: `switcher.js` — the St modal popup (Shell API)

**Files:**
- Create: `gnome/oneswitch@oneness.health/lib/switcher.js`
- Create: `gnome/oneswitch@oneness.health/stylesheet.css`

`switcher.js` owns the entire UI: a centered modal with a search entry and a scrollable result list, keyboard navigation, selection highlight, and Enter activation. It pulls items from `windows.js`, orders them with `model.js`, and picks the initial selection with `recency.js`.

- [ ] **Step 1: Write the stylesheet**

`gnome/oneswitch@oneness.health/stylesheet.css`:

```css
.oneswitch-popup {
  background-color: rgba(30, 30, 32, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 14px;
  padding: 10px;
  width: 640px;
}
.oneswitch-entry {
  font-size: 15px;
  padding: 8px 10px;
  margin-bottom: 8px;
  border-radius: 8px;
}
.oneswitch-list { spacing: 2px; }
.oneswitch-row {
  padding: 7px 10px;
  border-radius: 8px;
  spacing: 10px;
}
.oneswitch-row:selected,
.oneswitch-row.selected {
  background-color: rgba(120, 150, 255, 0.35);
}
.oneswitch-row-title { font-size: 14px; }
.oneswitch-row-sub { font-size: 11px; color: rgba(255,255,255,0.55); }
```

- [ ] **Step 2: Write the popup implementation**

`gnome/oneswitch@oneness.health/lib/switcher.js`:

```js
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { filterAndRank } from './model.js';
import { preselectIndex } from './recency.js';
import * as Windows from './windows.js';

export const SwitcherPopup = GObject.registerClass(
class SwitcherPopup extends St.Widget {
  _init() {
    super._init({ reactive: true, visible: false });
    this._grab = null;
    this._items = [];      // currently displayed (filtered) items
    this._selected = 0;
    this._rows = [];

    // Dim background.
    Main.layoutManager.modalDialogGroup.add_child(this);
    this.add_constraint(new Clutter.BindConstraint({
      source: Main.layoutManager.modalDialogGroup,
      coordinate: Clutter.BindCoordinate.ALL,
    }));

    // Centered popup box.
    this._box = new St.BoxLayout({
      style_class: 'oneswitch-popup',
      vertical: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this.add_child(this._box);
    this._box.add_constraint(new Clutter.AlignConstraint({
      source: this, align_axis: Clutter.AlignAxis.BOTH, factor: 0.5,
    }));

    this._entry = new St.Entry({ style_class: 'oneswitch-entry', can_focus: true });
    this._entry.clutter_text.connect('text-changed', () => this._refilter());
    this._box.add_child(this._entry);

    this._scroll = new St.ScrollView({ overlay_scrollbars: true });
    this._scroll.set_height(380);
    this._list = new St.BoxLayout({ style_class: 'oneswitch-list', vertical: true });
    this._scroll.add_child(this._list);
    this._box.add_child(this._scroll);

    this.connect('key-press-event', (_a, ev) => this._onKey(ev));
  }

  open() {
    if (this.visible) return;
    // Source rows + initial selection BEFORE the focus changes to the popup.
    const focused = Windows.focusedWindowId();
    this._all = Windows.listWindows();
    this._items = this._all.slice();
    this._selected = preselectIndex(this._items, focused);

    this._entry.set_text('');
    this._render();
    this.visible = true;

    this._grab = Main.pushModal(this, { actionMode: Shell.ActionMode.POPUP });
    if (!this._grab) { this.close(); return; }
    global.stage.set_key_focus(this._entry.clutter_text);
  }

  close() {
    if (!this.visible) return;
    if (this._grab) { Main.popModal(this._grab); this._grab = null; }
    this.visible = false;
  }

  toggle() { this.visible ? this.close() : this.open(); }

  _refilter() {
    const q = this._entry.get_text();
    this._items = filterAndRank(this._all, q);
    this._selected = 0;
    this._render();
  }

  _render() {
    this._list.destroy_all_children();
    this._rows = [];
    this._items.forEach((it, i) => {
      const row = new St.BoxLayout({ style_class: 'oneswitch-row', reactive: true });
      if (it.app) {
        const icon = it.app.create_icon_texture(22);
        if (icon) row.add_child(icon);
      }
      const text = new St.BoxLayout({ vertical: true });
      text.add_child(new St.Label({ style_class: 'oneswitch-row-title', text: it.title || '(untitled)' }));
      text.add_child(new St.Label({ style_class: 'oneswitch-row-sub', text: it.appName || '' }));
      row.add_child(text);
      row.connect('button-press-event', () => { this._activateIndex(i); return Clutter.EVENT_STOP; });
      this._list.add_child(row);
      this._rows.push(row);
    });
    this._highlight();
  }

  _highlight() {
    this._rows.forEach((r, i) => {
      if (i === this._selected) r.add_style_class_name('selected');
      else r.remove_style_class_name('selected');
    });
    const row = this._rows[this._selected];
    if (row) Main.layoutManager.modalDialogGroup; // no-op placeholder; scroll-to in Task 6
  }

  _move(delta) {
    if (this._items.length === 0) return;
    this._selected = (this._selected + delta + this._items.length) % this._items.length;
    this._highlight();
  }

  _activateIndex(i) {
    const it = this._items[i];
    this.close();
    if (it) Windows.activate(it.metaWindow);
  }

  _onKey(ev) {
    const sym = ev.get_key_symbol();
    const state = ev.get_state();
    const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
    if (sym === Clutter.KEY_Escape) { this.close(); return Clutter.EVENT_STOP; }
    if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
      this._activateIndex(this._selected); return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Down || (ctrl && sym === Clutter.KEY_n)) { this._move(1); return Clutter.EVENT_STOP; }
    if (sym === Clutter.KEY_Up || (ctrl && sym === Clutter.KEY_p)) { this._move(-1); return Clutter.EVENT_STOP; }
    if (sym === Clutter.KEY_Tab) { this._move(1); return Clutter.EVENT_STOP; }
    if (sym === Clutter.KEY_ISO_Left_Tab) { this._move(-1); return Clutter.EVENT_STOP; }
    return Clutter.EVENT_PROPAGATE;
  }

  destroy() { this.close(); super.destroy(); }
});
```

- [ ] **Step 3: Add the missing `Shell` import**

The popup references `Shell.ActionMode.POPUP`. At the top of `switcher.js`, add to the imports:

```js
import Shell from 'gi://Shell';
```

- [ ] **Step 4: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/switcher.js gnome/oneswitch@oneness.health/stylesheet.css
git commit -m "feat(gnome): St modal popup with search + keyboard navigation"
```

---

### Task 6: `extension.js` — lifecycle, hotkey, scroll-to-selection

**Files:**
- Create: `gnome/oneswitch@oneness.health/extension.js`
- Modify: `gnome/oneswitch@oneness.health/lib/switcher.js` (replace the `_highlight` scroll placeholder)

- [ ] **Step 1: Replace the scroll placeholder in `switcher.js`**

In `switcher.js`, replace the `_highlight()` method body's placeholder line:

```js
    const row = this._rows[this._selected];
    if (row) Main.layoutManager.modalDialogGroup; // no-op placeholder; scroll-to in Task 6
```

with an actual scroll-into-view:

```js
    const row = this._rows[this._selected];
    if (row) {
      const adj = this._scroll.vscroll ? this._scroll.vscroll.adjustment
                                       : this._scroll.get_vadjustment();
      if (adj) {
        const [, y] = row.get_transformed_position();
        const top = adj.value, bottom = top + adj.page_size;
        const ry = row.allocation.y1;
        if (ry < top) adj.value = ry;
        else if (ry + row.height > bottom) adj.value = ry + row.height - adj.page_size;
      }
    }
```

(If the live GNOME 47 API for the scrollbar adjustment differs, adjust here — this is the one spot that reads the scroll adjustment.)

- [ ] **Step 2: Write `extension.js`**

`gnome/oneswitch@oneness.health/extension.js`:

```js
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SwitcherPopup } from './lib/switcher.js';

export default class OneSwitchExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._popup = new SwitcherPopup();
    Main.wm.addKeybinding(
      'hotkey',
      this._settings,
      Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
      () => this._popup.toggle());
  }

  disable() {
    Main.wm.removeKeybinding('hotkey');
    if (this._popup) { this._popup.destroy(); this._popup = null; }
    this._settings = null;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add gnome/oneswitch@oneness.health/extension.js gnome/oneswitch@oneness.health/lib/switcher.js
git commit -m "feat(gnome): extension lifecycle + global hotkey + scroll-to-selection"
```

---

### Task 7: Dev-loop tooling + nested-shell acceptance

**Files:**
- Create: `gnome/Makefile`
- Create: `gnome/README.md`

- [ ] **Step 1: Write the `Makefile`**

`gnome/Makefile`:

```make
UUID = oneswitch@oneness.health
SRC  = $(UUID)
DEST = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: test schemas install uninstall nested logs

test:
	node --test

schemas:
	glib-compile-schemas $(SRC)/schemas/

install: schemas
	rm -rf "$(DEST)"
	mkdir -p "$(DEST)"
	cp -r $(SRC)/. "$(DEST)/"

uninstall:
	rm -rf "$(DEST)"

# Run a throwaway nested shell with the extension available (Wayland).
nested: install
	dbus-run-session -- gnome-shell --nested --wayland

logs:
	journalctl -f -o cat /usr/bin/gnome-shell
```

- [ ] **Step 2: Write `README.md`**

`gnome/README.md`:

```markdown
# OneSwitch for GNOME (Wayland)

GNOME 47 Shell extension. Phase 1: window switcher on a global hotkey.

## Dev loop (no logout needed)
1. `make test`            # run pure-module unit tests
2. `make install`         # copy extension into ~/.local/share + compile schema
3. `make nested`          # launch a nested GNOME Shell (Wayland)
   In the nested shell: `gnome-extensions enable oneswitch@oneness.health`
4. Press **Control+Tab** inside the nested shell to open the switcher.
5. Logs: `make logs` (or Alt-F2 → `lg` for Looking Glass).

## Acceptance (Phase 1)
- Control+Tab opens a centered popup; the **previous** window is preselected.
- Typing filters; Tab/↓/Ctrl-N and Shift-Tab/↑/Ctrl-P move selection.
- Enter activates the selected window; Esc dismisses.
- Control+Tab then Enter bounces between the two most-recent windows.
```

- [ ] **Step 3: Run the unit tests**

Run: `cd gnome && make test`
Expected: PASS — `model.test.js` and `recency.test.js` all green.

- [ ] **Step 4: Manual acceptance in a nested shell**

Run: `cd gnome && make nested`
Then inside the nested shell: `gnome-extensions enable oneswitch@oneness.health`
Open 3+ windows in the nested session and verify every bullet in the README "Acceptance (Phase 1)" list. Fix issues in `windows.js` / `switcher.js` / `extension.js` and re-run `make install` + reload the nested shell as needed.

Expected: all acceptance bullets pass.

- [ ] **Step 5: Commit**

```bash
git add gnome/Makefile gnome/README.md
git commit -m "chore(gnome): dev-loop Makefile + README + Phase 1 acceptance"
```

---

## Self-Review

**Spec coverage (Phase 1 slice of the spec):**
- Global hotkey (GSettings + `add_keybinding`) → Task 1 (schema) + Task 6. ✅
- Centered modal popup with keyboard grab (`Main.pushModal`) → Task 5. ✅
- Window list in MRU order (`get_tab_list`) → Task 4. ✅
- Previous-window preselect → Task 3 + wired in Task 5 `open()`. ✅
- Orderless fuzzy search + ranking → Task 2. ✅
- Keyboard navigation (Tab/Shift-Tab/↑/↓/Ctrl-N/Ctrl-P/Enter/Esc) → Task 5 `_onKey`. ✅
- App icons in rows (`create_icon_texture`) → Task 5 `_render`. ✅
- Activation (`Main.activateWindow`) → Task 4 + Task 5. ✅
- Unit tests for pure modules (Node) → Tasks 2, 3. ✅
- Nested-shell dev loop → Task 7. ✅

Out of Phase-1 scope (later plans): launcher/.desktop, command mode, browser tabs, favicons, indicator + prefs hotkey recorder, NixOS flake/home-manager packaging.

**Placeholder scan:** The only deliberate "verify against live API" notes are the scroll-adjustment block (Task 6 Step 1) and `windows.js` syntax-check caveat (Task 4 Step 2) — both unavoidable because Shell APIs can only be confirmed in a running shell, and both are localized to one spot with concrete code given. No TODO/TBD left.

**Type consistency:** Item shape `{ id, title, appName, windowId, metaWindow, app }` is produced in `windows.js` (Task 4) and consumed unchanged by `model.js` (reads `title`/`appName`), `recency.js` (reads `windowId`), and `switcher.js` (reads `app`/`title`/`appName`/`metaWindow`). `filterAndRank(items, query)` and `preselectIndex(items, focusedId)` signatures match their call sites in `switcher.js`. ✅
