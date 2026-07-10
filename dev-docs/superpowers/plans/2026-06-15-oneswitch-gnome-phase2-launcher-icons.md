# OneSwitch GNOME Port — Phase 2: App Launcher & Icons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the switcher so installed-but-not-running apps appear *while searching* (ranked below open windows), and pressing Enter on one launches it; every row shows a real icon.

**Architecture:** Add a `Gio.AppInfo`-backed catalog (`apps.js`) and a pure result-composition function (`composeResults` in `model.js`) that appends app results after window results only when there is a query. The popup (`switcher.js`) sources both, renders app rows from `Gio.Icon`, and dispatches Enter to launch vs activate by item `kind`.

**Tech Stack:** GJS, `Gio.AppInfo`, `Shell.WindowTracker`, `St.Icon`, Node `node --test` for the pure composition logic.

**Prerequisite:** Phase 1 complete (extension loads, popup lists/activates windows).

---

## File Structure (Phase 2)

```
gnome/oneswitch@oneness.health/lib/
  apps.js          # NEW  Gio.AppInfo catalog of not-running apps + launch
  model.js         # MOD  add composeResults(windows, apps, query)
  windows.js       # MOD  add kind:'window'; add openAppIds()
  switcher.js      # MOD  source apps, render app rows, launch-or-activate
gnome/test/
  model.test.js    # MOD  add composeResults tests
```

Item shapes after Phase 2:
- window: `{ id, kind:'window', title, appName, windowId, metaWindow, app }`
- app: `{ id, kind:'app', title, appName:'', gicon, appInfo }`

---

### Task 1: `composeResults` — windows always, apps only while searching (PURE, TDD)

**Files:**
- Modify: `gnome/oneswitch@oneness.health/lib/model.js`
- Test: `gnome/test/model.test.js`

- [ ] **Step 1: Add the failing tests**

Append to `gnome/test/model.test.js`:

```js
import { composeResults } from '../oneswitch@oneness.health/lib/model.js';

const wins = [
  { id: 'w1', kind: 'window', title: 'Inbox', appName: 'Firefox' },
  { id: 'w2', kind: 'window', title: 'Code', appName: 'Code' },
];
const apps = [
  { id: 'a1', kind: 'app', title: 'Calculator', appName: '' },
  { id: 'a2', kind: 'app', title: 'Code - OSS', appName: '' },
];

test('empty query returns windows only, no apps', () => {
  assert.deepEqual(composeResults(wins, apps, '').map(i => i.id), ['w1', 'w2']);
});

test('query appends matching apps after matching windows', () => {
  const r = composeResults(wins, apps, 'code').map(i => i.id);
  assert.deepEqual(r, ['w2', 'a2']); // window match first, then app match
});

test('apps that do not match are excluded', () => {
  const r = composeResults(wins, apps, 'calc').map(i => i.id);
  assert.deepEqual(r, ['a1']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd gnome && node --test test/model.test.js`
Expected: FAIL — `composeResults` is not exported.

- [ ] **Step 3: Implement `composeResults`**

Append to `gnome/oneswitch@oneness.health/lib/model.js`:

```js
// Windows always show; apps only while searching, ranked after windows.
export function composeResults(windows, apps, query) {
  const w = filterAndRank(windows, query);
  if (!(query || '').trim()) return w;
  const a = filterAndRank(apps, query);
  return w.concat(a);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd gnome && node --test test/model.test.js`
Expected: PASS — all model tests (Phase 1 + new) green.

- [ ] **Step 5: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/model.js gnome/test/model.test.js
git commit -m "feat(gnome): compose window + app results (apps only while searching)"
```

---

### Task 2: `windows.js` — tag windows + expose open-app ids

**Files:**
- Modify: `gnome/oneswitch@oneness.health/lib/windows.js`

- [ ] **Step 1: Tag each window item with `kind:'window'`**

In `listWindows()`, change the pushed object to include `kind`:

```js
    items.push({
      id: `win-${w.get_id()}`,
      kind: 'window',
      title: w.get_title() || '',
      appName: app ? app.get_name() : '',
      windowId: w.get_id(),
      metaWindow: w,
      app,
    });
```

- [ ] **Step 2: Add `openAppIds()`**

Append to `gnome/oneswitch@oneness.health/lib/windows.js`:

```js
// Desktop ids ("firefox.desktop") of apps that currently have a window open.
export function openAppIds() {
  const tracker = Shell.WindowTracker.get_default();
  const ids = new Set();
  for (const w of global.display.get_tab_list(Meta.TabList.NORMAL, null)) {
    const app = tracker.get_window_app(w);
    if (app) ids.add(app.get_id());
  }
  return ids;
}
```

- [ ] **Step 3: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/windows.js
git commit -m "feat(gnome): tag window items + expose open-app ids"
```

---

### Task 3: `apps.js` — `.desktop` catalog + launch

**Files:**
- Create: `gnome/oneswitch@oneness.health/lib/apps.js`

- [ ] **Step 1: Write `apps.js`**

`gnome/oneswitch@oneness.health/lib/apps.js`:

```js
import Gio from 'gi://Gio';

// Installed apps (that pass should_show) which are NOT in openIds.
// openIds is a Set of desktop ids ("firefox.desktop").
export function listApps(openIds) {
  const out = [];
  for (const info of Gio.AppInfo.get_all()) {
    if (!info.should_show()) continue;
    const id = info.get_id();
    if (openIds.has(id)) continue;
    out.push({
      id: `app-${id}`,
      kind: 'app',
      title: info.get_display_name() || info.get_name() || '',
      appName: '',
      gicon: info.get_icon(),     // Gio.Icon | null
      appInfo: info,
    });
  }
  return out;
}

export function launch(appInfo) {
  const ctx = global.create_app_launch_context(0, -1);
  appInfo.launch([], ctx);
}
```

- [ ] **Step 2: Syntax-check with gjs**

Run: `gjs -c "import('./gnome/oneswitch@oneness.health/lib/apps.js').then(()=>print('ok')).catch(e=>{printerr(e)})"`
Expected: prints `ok` OR errors only about `global` being undefined (runtime-only symbol). A `SyntaxError` means fix the file.

- [ ] **Step 3: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/apps.js
git commit -m "feat(gnome): installed-app catalog + launch"
```

---

### Task 4: `switcher.js` — source apps, render app rows, launch-or-activate

**Files:**
- Modify: `gnome/oneswitch@oneness.health/lib/switcher.js`

- [ ] **Step 1: Import the new modules**

Add near the other imports in `switcher.js`:

```js
import Gio from 'gi://Gio';
import { composeResults } from './model.js';
import * as Apps from './apps.js';
```

(Keep the existing `import { filterAndRank } from './model.js';` — or change it to `import { filterAndRank, composeResults } from './model.js';` and drop the separate line. Either is fine; do not import `composeResults` twice.)

- [ ] **Step 2: Source apps in `open()`**

In `open()`, after `this._all = Windows.listWindows();`, add app sourcing:

```js
    this._apps = Apps.listApps(Windows.openAppIds());
    this._items = composeResults(this._all, this._apps, '');
```

(Replace the old `this._items = this._all.slice();` line with the `composeResults(...)` line above.)

- [ ] **Step 3: Use `composeResults` in `_refilter()`**

Replace the body of `_refilter()` with:

```js
  _refilter() {
    const q = this._entry.get_text();
    this._items = composeResults(this._all, this._apps, q);
    this._selected = 0;
    this._render();
  }
```

- [ ] **Step 4: Render app-row icons from `gicon`**

In `_render()`, replace the icon block:

```js
      if (it.app) {
        const icon = it.app.create_icon_texture(22);
        if (icon) row.add_child(icon);
      }
```

with one that handles both window apps and app-catalog gicons:

```js
      if (it.kind === 'window' && it.app) {
        const icon = it.app.create_icon_texture(22);
        if (icon) row.add_child(icon);
      } else if (it.kind === 'app' && it.gicon) {
        row.add_child(new St.Icon({ gicon: it.gicon, icon_size: 22 }));
      }
```

- [ ] **Step 5: Launch vs activate in `_activateIndex()`**

Replace `_activateIndex()` with:

```js
  _activateIndex(i) {
    const it = this._items[i];
    this.close();
    if (!it) return;
    if (it.kind === 'app') Apps.launch(it.appInfo);
    else Windows.activate(it.metaWindow);
  }
```

- [ ] **Step 6: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/switcher.js
git commit -m "feat(gnome): app rows in the switcher; Enter launches not-running apps"
```

---

### Task 5: Nested-shell acceptance

**Files:** none (manual verification).

- [ ] **Step 1: Reinstall and run the nested shell**

Run: `cd gnome && make install && make nested`
Then inside: `gnome-extensions enable oneswitch@oneness.health`

- [ ] **Step 2: Verify the acceptance criteria**

- With an empty query, only open windows appear (no apps).
- Typing the name of an installed-but-closed app (e.g. "calculator") shows it **below** any matching windows, with its icon.
- Enter on that app row launches it and the popup closes.
- Enter on a window row still activates the window (Phase 1 unaffected).

Expected: all four pass. Fix in `apps.js` / `switcher.js` and reinstall as needed.

- [ ] **Step 3: Run unit tests once more**

Run: `cd gnome && make test`
Expected: PASS.

- [ ] **Step 4: Commit (if any fixes were made)**

```bash
git add -A gnome/
git commit -m "fix(gnome): Phase 2 launcher acceptance fixes"
```

---

## Self-Review

**Spec coverage (Phase 2 slice):** installed-app catalog (`Gio.AppInfo`) → Task 3 ✅; apps appear only while searching, ranked below windows → Task 1 (`composeResults`) ✅; Enter launches a not-running app → Task 4 Step 5 ✅; real row icons for windows and apps → Task 4 Step 4 ✅.

**Placeholder scan:** none — every step shows full code or exact verification.

**Type consistency:** `composeResults(windows, apps, query)` (Task 1) is called with `(this._all, this._apps, q)` in `switcher.js` (Task 4). `listApps(openIds)` returns `{kind:'app', gicon, appInfo, …}` (Task 3), consumed in `_render`/`_activateIndex` (Task 4). `openAppIds()` returns desktop-id Set (Task 2) matching `Gio.AppInfo.get_id()` used in Task 3's filter. ✅
