import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Shell from 'gi://Shell';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { composeResults, dropTabbedBrowserWindows } from './model.js';
import { preselectIndexWithTabs } from './recency.js';
import { parseQuery } from './query.js';
import { matchCommands } from './history.js';
import { readHistory, readPathCommands } from './history-io.js';
import { CommandRunner } from './command.js';
import Gio from 'gi://Gio';
import * as Windows from './windows.js';
import * as Apps from './apps.js';
import * as Browser from './browser.js';
import * as Favicons from './favicons.js';
import { DESKTOP_INTERFACE_SCHEMA, COLOR_SCHEME_KEY, applyPalette } from './theme.js';

// Tells you which build the Shell actually has in memory: modules are imported
// once per session, so after editing extension code this line only reappears
// after a real reload (log out/in on Wayland).
log('[OneSwitch] switcher module loaded (build with window/tab dedupe)');

export class SwitcherPopup {
  constructor() {
    this._grab = null;
    this._items = [];
    this._selected = 0;
    this._rows = [];
    this._mode = 'search';
    this._history = [];
    this._opening = false;

    this._box = new St.BoxLayout({
      style_class: 'oneswitch-popup',
      reactive: true,
      visible: false,
      vertical: true,
    });
    // Add to global.stage so no layout manager can stretch or reposition it.
    global.stage.insert_child_above(this._box, null);

    // Match the shell's own light/dark choice, and keep matching it when the user
    // flips Appearance in Settings while we are running.
    this._ifaceSettings = new Gio.Settings({ schema_id: DESKTOP_INTERFACE_SCHEMA });
    applyPalette(this._box, this._ifaceSettings.get_string(COLOR_SCHEME_KEY));
    this._schemeId = this._ifaceSettings.connect(`changed::${COLOR_SCHEME_KEY}`, () => {
      applyPalette(this._box, this._ifaceSettings.get_string(COLOR_SCHEME_KEY));
    });

    this._entry = new St.Entry({ style_class: 'oneswitch-entry', can_focus: true });
    this._entry.clutter_text.connect('text-changed', () => { if (!this._opening) this._refilter(); });
    this._entry.clutter_text.connect('key-press-event', (_a, ev) => {
      const sym = ev.get_key_symbol();
      log(`[OneSwitch] key sym=${sym} box=${this._box.x},${this._box.y} ${this._box.width}x${this._box.height}`);
      return this._onKey(ev);
    });
    this._box.add_child(this._entry);

    this._scroll = new St.ScrollView({ overlay_scrollbars: true });
    this._scroll.set_height(380);
    this._list = new St.BoxLayout({ style_class: 'oneswitch-list', vertical: true });
    this._scroll.add_child(this._list);
    this._box.add_child(this._scroll);

    // Command output replaces the list while a command runs, so long output
    // scrolls in place instead of growing the popup past the screen.
    this._outputScroll = new St.ScrollView({ overlay_scrollbars: true });
    this._outputScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
    this._outputScroll.set_height(380);
    this._outputScroll.visible = false;
    const outputBox = new St.BoxLayout({ vertical: true });
    this._output = new St.Label({ style_class: 'oneswitch-output', text: '' });
    this._output.clutter_text.line_wrap = true;
    outputBox.add_child(this._output);
    this._outputScroll.add_child(outputBox);
    this._box.add_child(this._outputScroll);

    this._runner = new CommandRunner();
  }

  open() {
    if (this._box.visible) return;
    const focused = Windows.focusedWindowId();
    const wins = Windows.listWindows();
    const tabs = Browser.listTabs();
    // Pick the target on the *full* list first: a browser window is still "the
    // previous window" even though we no longer list it (its tabs stand for it).
    // Then drop the tabbed browser windows and translate that target to the
    // browser's active tab, so Ctrl+Tab still bounces back where you were.
    const full = wins.concat(tabs);
    const kept = dropTabbedBrowserWindows(wins, tabs);
    const selected = preselectIndexWithTabs(full, kept, tabs, focused);
    this._all = kept.concat(tabs);
    this._tabs = tabs;
    this._apps = Apps.listApps(Windows.openAppIds());
    this._history = readHistory();
    this._pathCommands = null; // scanned lazily on first command-mode keystroke
    this._showOutput(false);
    this._output.set_text('');
    this._mode = 'search';

    this._opening = true;
    this._entry.set_text('');
    this._opening = false;
    this._items = composeResults(this._all, this._apps, '');
    this._selected = Math.max(0, Math.min(selected, this._items.length - 1));
    // `activeTabs` is the canary for the bug this line exists to catch: the
    // snapshot must flag exactly one of the browser's tabs, and `active=` says
    // whether the preselected row is that one. Both at 0/false means a dropped
    // field upstream, not a wrong tab.
    const sel = this._items[this._selected];
    log(`[OneSwitch] open: focusedId=${focused} preselect=${this._selected} ` +
        `windows=${this._all.length - this._tabs.length} tabs=${this._tabs.length} ` +
        `activeTabs=${this._tabs.filter(t => t.active).length} ` +
        `item="${sel?.title}" kind=${sel?.kind ?? '-'}` +
        `${sel?.kind === 'tab' ? ` active=${!!sel.active}` : ''} ` +
        `item0="${this._items[0]?.title}" item1="${this._items[1]?.title}"`);

    // Show the popup before building the rows, and re-apply the highlight once the
    // rows are mapped and the layout has run (below). The highlight needs a mapped,
    // allocated, repainted actor to actually appear — see _highlight().
    this._box.visible = true;
    this._render();

    // global.stage has no layout manager — set_position sticks.
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      const monitor = Main.layoutManager.primaryMonitor;
      this._box.set_position(
        Math.round(monitor.x + (monitor.width  - this._box.width)  / 2),
        Math.round(monitor.y + (monitor.height - this._box.height) / 2),
      );
      this._highlight();   // rows are mapped/allocated now — make the highlight stick
      return GLib.SOURCE_REMOVE;
    });

    this._grab = Main.pushModal(this._box, { actionMode: Shell.ActionMode.POPUP });
    if (!this._grab) { this.close(); return; }
    global.stage.set_key_focus(this._entry.clutter_text);
  }

  close() {
    if (this._runner) this._runner.cancel();
    if (!this._box.visible) return;
    if (this._grab) { Main.popModal(this._grab); this._grab = null; }
    this._box.visible = false;
  }

  toggle() { this._box.visible ? this.close() : this.open(); }

  _refilter() {
    log(`[OneSwitch] _refilter called, text="${this._entry.get_text()}"`);
    this._showOutput(false);
    const parsed = parseQuery(this._entry.get_text());
    this._mode = parsed.mode;
    if (parsed.mode === 'command') {
      if (!this._pathCommands) this._pathCommands = readPathCommands();
      this._items = matchCommands(this._history, this._pathCommands, parsed.value)
        .map((e, i) => ({ id: `cmd-${i}`, kind: 'cmd', title: e.cmd, appName: '', source: e.source }));
    } else if (parsed.mode === 'web') {
      this._items = parsed.value
        ? [{ id: 'web-0', kind: 'web', title: `Search Google for “${parsed.value}”`, appName: '', query: parsed.value }]
        : [];
    } else {
      this._items = composeResults(this._all, this._apps, parsed.value);
    }
    this._selected = 0;
    this._render();
  }

  _render() {
    this._list.destroy_all_children();
    this._rows = [];
    this._items.forEach((it, i) => {
      const row = new St.BoxLayout({ style_class: 'oneswitch-row', reactive: true });
      if (it.kind === 'window' && it.app) {
        const icon = it.app.create_icon_texture(22);
        if (icon) row.add_child(icon);
      } else if (it.kind === 'app' && it.gicon) {
        row.add_child(new St.Icon({ gicon: it.gicon, icon_size: 22 }));
      } else if (it.kind === 'tab') {
        // No usable favicon is normal: sites ship .ico files the Shell cannot
        // paint, and some ship nothing at all. A generic globe keeps the row
        // aligned instead of dropping the icon slot.
        const path = Favicons.cachedFaviconPath(it.url);
        row.add_child(new St.Icon(path
          ? { gicon: Gio.icon_new_for_string(path), icon_size: 22 }
          : { icon_name: 'web-browser-symbolic', icon_size: 22 }));
      } else if (it.kind === 'web') {
        row.add_child(new St.Icon({ icon_name: 'system-search-symbolic', icon_size: 22 }));
      } else if (it.kind === 'cmd' && it.source === 'path') {
        row.add_child(new St.Icon({ icon_name: 'application-x-executable-symbolic', icon_size: 22 }));
      }
      const text = new St.BoxLayout({ vertical: true });
      text.add_child(new St.Label({ style_class: 'oneswitch-row-title', text: it.title || '(untitled)' }));
      if (it.appName) text.add_child(new St.Label({ style_class: 'oneswitch-row-sub', text: it.appName }));
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
    const adj = this._scroll.vscroll ? this._scroll.vscroll.adjustment
                                     : this._scroll.get_vadjustment();

    let info = `sel=${this._selected}/${this._rows.length}`;
    if (row) info += ` y=${row.allocation.y1}..${row.allocation.y2} cls=${row.has_style_class_name('selected')}`;
    info += adj ? ` adj(v=${adj.value} u=${adj.upper} p=${adj.page_size})` : ' adj=nil';
    log(`[OneSwitch] _highlight ${info}`);

    // Scroll the selected row into view, but only once the ScrollView has a real
    // viewport (page_size > 0). Before layout page_size is 0, which made the old
    // `ry + h - page_size` branch jump the list so the selected row sat off-screen.
    if (row && adj && adj.page_size > 0) {
      const ry = row.allocation.y1;
      const rh = row.allocation.y2 - row.allocation.y1;
      if (isFinite(ry) && isFinite(rh)) {
        if (ry < adj.value) adj.value = ry;
        else if (ry + rh > adj.value + adj.page_size) adj.value = ry + rh - adj.page_size;
      }
    }

    // St only invalidates geometry/paint-volume on a style change — it does not
    // queue a redraw for a pure class swap (same geometry), so the highlight can go
    // unpainted until something else forces a repaint. Typing forced one via the
    // filtered relayout; a plain summon didn't. Force it here so the selection
    // always shows.
    this._rows.forEach(r => r.queue_redraw());
  }

  _move(delta) {
    if (this._items.length === 0) return;
    this._selected = (this._selected + delta + this._items.length) % this._items.length;
    this._highlight();
  }

  _activateIndex(i) {
    log(`[OneSwitch] _activateIndex(${i}) selected=${this._selected} items=${this._items.length}`);
    const it = this._items[i];
    if (this._mode === 'command') {
      const cmd = it ? it.title : '';
      if (cmd) this._runCommand(cmd);
      return;
    }
    if (this._mode === 'web') {
      const query = it ? it.query : '';
      this.close();
      if (query) {
        Gio.AppInfo.launch_default_for_uri(
          'https://www.google.com/search?q=' + encodeURIComponent(query),
          global.create_app_launch_context(0, -1));
      }
      return;
    }
    this.close();
    if (!it) return;
    if (it.kind === 'tab') {
      Browser.activateTab(it);
      Windows.raiseBrowserWindow(it.browser, it.title);
      return;
    }
    if (it.kind === 'app') {
      Apps.launch(it.appInfo);
    } else {
      const win = it.metaWindow;
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { Windows.activate(win); return GLib.SOURCE_REMOVE; });
    }
  }

  _runCommand(cmd) {
    this._showOutput(true);
    this._output.set_text('running…');
    this._runner.run(cmd, ({ output, code }) => {
      this._output.set_text(`$ ${cmd}\n${output}\n[exit ${code}] (copied to clipboard)`);
    });
  }

  // Swap between the result list and the command output pane; only one is
  // visible at a time so output appears directly under the entry.
  _showOutput(show) {
    this._outputScroll.visible = show;
    this._scroll.visible = !show;
  }

  _onKey(ev) {
    const sym = ev.get_key_symbol();
    const state = ev.get_state();
    const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
    if (sym === Clutter.KEY_Escape) {
      if (this._runner) this._runner.cancel();
      this.close();
      return Clutter.EVENT_STOP;
    }
    if (ctrl && sym === Clutter.KEY_j) {
      const parsed = parseQuery(this._entry.get_text());
      if (parsed.mode === 'command' && parsed.value) this._runCommand(parsed.value);
      return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
      this._activateIndex(this._selected); return Clutter.EVENT_STOP;
    }
    if (sym === Clutter.KEY_Down || (ctrl && sym === Clutter.KEY_n)) { this._move(1); return Clutter.EVENT_STOP; }
    if (sym === Clutter.KEY_Up || (ctrl && sym === Clutter.KEY_p)) { this._move(-1); return Clutter.EVENT_STOP; }
    if (sym === Clutter.KEY_Tab) { this._move(1); return Clutter.EVENT_STOP; }
    if (sym === Clutter.KEY_ISO_Left_Tab) { this._move(-1); return Clutter.EVENT_STOP; }
    return Clutter.EVENT_PROPAGATE;
  }

  destroy() {
    this.close();
    if (this._schemeId) {
      this._ifaceSettings.disconnect(this._schemeId);
      this._schemeId = null;
    }
    this._ifaceSettings = null;
    if (this._box) { this._box.destroy(); this._box = null; }
  }
}
