import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Shell from 'gi://Shell';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { filterAndRank, composeResults } from './model.js';
import { preselectIndex } from './recency.js';
import { parseQuery } from './query.js';
import { matchHistory } from './history.js';
import { readHistory } from './history-io.js';
import { CommandRunner } from './command.js';
import * as Windows from './windows.js';
import * as Apps from './apps.js';

export const SwitcherPopup = GObject.registerClass(
class SwitcherPopup extends St.Widget {
  _init() {
    super._init({ reactive: true, visible: false });
    this._grab = null;
    this._items = [];
    this._selected = 0;
    this._rows = [];
    this._mode = 'search';
    this._history = [];

    Main.layoutManager.modalDialogGroup.add_child(this);
    this.add_constraint(new Clutter.BindConstraint({
      source: Main.layoutManager.modalDialogGroup,
      coordinate: Clutter.BindCoordinate.ALL,
    }));

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

    this._output = new St.Label({ style_class: 'oneswitch-output', text: '' });
    this._output.clutter_text.line_wrap = true;
    this._output.visible = false;
    this._box.add_child(this._output);

    this._runner = new CommandRunner();

    this.connect('key-press-event', (_a, ev) => this._onKey(ev));
  }

  open() {
    if (this.visible) return;
    const focused = Windows.focusedWindowId();
    this._all = Windows.listWindows();
    this._apps = Apps.listApps(Windows.openAppIds());
    this._items = composeResults(this._all, this._apps, '');
    this._selected = preselectIndex(this._items, focused);
    this._history = readHistory();
    this._output.visible = false;
    this._output.set_text('');
    this._mode = 'search';

    this._entry.set_text('');
    this._render();
    this.visible = true;

    this._grab = Main.pushModal(this, { actionMode: Shell.ActionMode.POPUP });
    if (!this._grab) { this.close(); return; }
    global.stage.set_key_focus(this._entry.clutter_text);
  }

  close() {
    if (this._runner) this._runner.cancel();
    if (!this.visible) return;
    if (this._grab) { Main.popModal(this._grab); this._grab = null; }
    this.visible = false;
  }

  toggle() { this.visible ? this.close() : this.open(); }

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
    if (row) {
      const adj = this._scroll.vscroll ? this._scroll.vscroll.adjustment
                                       : this._scroll.get_vadjustment();
      if (adj) {
        const top = adj.value, bottom = top + adj.page_size;
        const ry = row.allocation.y1;
        if (ry < top) adj.value = ry;
        else if (ry + row.height > bottom) adj.value = ry + row.height - adj.page_size;
      }
    }
  }

  _move(delta) {
    if (this._items.length === 0) return;
    this._selected = (this._selected + delta + this._items.length) % this._items.length;
    this._highlight();
  }

  _activateIndex(i) {
    const it = this._items[i];
    if (this._mode === 'command') {
      const cmd = it ? it.title : '';
      if (cmd) this._runCommand(cmd);
      return;
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

  destroy() { this.close(); super.destroy(); }
});
