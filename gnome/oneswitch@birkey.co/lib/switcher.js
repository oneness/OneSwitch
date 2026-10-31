import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { composeResults, orderWithTabs } from './model.js';
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
log('[OneSwitch] switcher module loaded (build with recency-ordered tab prefix, scroll reset)');

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
    // Build the list first, then pick in it. A browser window whose tabs we have is
    // replaced in place by those tabs in recency order (model.js orderWithTabs), so
    // its slot keeps its recency; the rest of its tabs trail the windows. Picking
    // against the same list is what makes the two most recent contexts — window,
    // browser tab, or two tabs of one browser — the top two rows.
    const ordered = orderWithTabs(wins, tabs);
    const selected = preselectIndexWithTabs(ordered, wins, tabs, focused);
    this._all = ordered;
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
    // Logged because this ordering is not derivable from the popup alone: `head` is
    // literally the top of the list, which is what "the last two windows should be
    // the top two rows" is a claim about. `activeTabs` is the canary for a dropped
    // field upstream — the snapshot must flag exactly one tab per browser.
    const sel = this._items[this._selected];
    const head = this._items.slice(0, 3)
      .map((it, i) => `${i}:${it.kind === 'tab' ? '@' : ''}${it.title || '(untitled)'}`);
    log(`[OneSwitch] open: focusedId=${focused} preselect=${this._selected} ` +
        `windows=${wins.length} rows=${ordered.length} tabs=${tabs.length} ` +
        `activeTabs=${tabs.filter(t => t.active).length} ` +
        `item="${sel?.title}" kind=${sel?.kind ?? '-'}` +
        `${sel?.kind === 'tab' ? ` active=${!!sel.active}` : ''} ` +
        `head=[${head.join(' | ')}]`);

    // Show the popup before building the rows: the highlight needs a mapped actor
    // to paint at all. _render() resets the list's scroll offset and applies the
    // selection; the idle below re-applies it once the popup's own size is known.
    this._box.visible = true;
    this._render();

    // global.stage has no layout manager — set_position sticks.
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      const monitor = Main.layoutManager.primaryMonitor;
      this._box.set_position(
        Math.round(monitor.x + (monitor.width  - this._box.width)  / 2),
        Math.round(monitor.y + (monitor.height - this._box.height) / 2),
      );
      // One more highlight pass after the position is known. Rows are still
      // unallocated here (the layout that measures them runs after this idle), so
      // this is not what makes the class stick — the queue_redraw in _highlight is.
      // Nothing here scrolls: the selection is in the top rows by construction.
      this._highlight();
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
    // The list is rebuilt, so its scroll offset has to be reset with it. The
    // ScrollView (and therefore its adjustment) is one object for the whole
    // session — it survives close() — so an offset left behind by wheel-scrolling
    // the list (or by an older build) is still in effect. Without this, the next
    // summon opens already scrolled: after wheeling down to row 10 of 19 the
    // following summon opened with the two most recent rows above the fold, which
    // reads as the highlight going missing. Every rebuild starts at row 0.
    const adj = this._adjustment();
    if (adj) adj.value = 0;
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

  // The visible list's vertical adjustment — `vscroll` on 3.36+, the plain getter
  // before that. Used by _render (reset) and _highlight (logging what it sits at).
  _adjustment() {
    if (!this._scroll) return null;
    return this._scroll.vscroll ? this._scroll.vscroll.adjustment
                                : this._scroll.get_vadjustment();
  }

  _highlight() {
    this._rows.forEach((r, i) => {
      if (i === this._selected) r.add_style_class_name('selected');
      else r.remove_style_class_name('selected');
    });

    const row = this._rows[this._selected];
    const adj = this._adjustment();

    let info = `sel=${this._selected}/${this._rows.length}`;
    if (row) info += ` y=${row.allocation.y1}..${row.allocation.y2} cls=${row.has_style_class_name('selected')}`;
    info += adj ? ` adj(v=${adj.value} u=${adj.upper} p=${adj.page_size})` : ' adj=nil';
    log(`[OneSwitch] _highlight ${info}`);

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
      Browser.activateTab(it, { sameBrowser: Windows.focusedIsBrowser(it.browser) });
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
