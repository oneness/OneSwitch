// Title Bar Manager — hides window title bars on maximize/tile
// following the exact approach of the Unite extension.
//
// Two mechanisms:
//   1. CSD (GTK Wayland) apps: Inject CSS into ~/.config/gtk-3.0/gtk.css
//      and ~/.config/gtk-4.0/gtk.css. GTK monitors these live via inotify.
//      CSS hides headerbars using .maximized/.tiled classes.
//   2. SSD (X11/XWayland) apps: xprop _MOTIF_WM_HINTS via Util.spawn.
//
// Per-window tracking: win.connect('size-changed') for maximize detection.
// Callbacks notify panel-title.js.

import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

const GTK_VERSIONS = [3, 4];

// Motif hints: { flags, functions, decorations, input_mode, status }
const _SHOW_FLAGS = ['0x2', '0x0', '0x1', '0x0', '0x0'];
const _HIDE_FLAGS = ['0x2', '0x0', '0x2', '0x0', '0x0'];
const MOTIF_HINTS = '_MOTIF_WM_HINTS';

// ---- GTK CSS for each mode (copied from Unite) ----

// "maximized" mode: hide when fully maximized
const GTK3_MAXIMIZED_CSS = `
.maximized > headerbar:not(.selection-mode),
.maximized > .titlebar:not(.selection-mode),
.maximized > headerbar > headerbar:not(.selection-mode),
.maximized > .titlebar > .titlebar:not(.selection-mode),
.maximized > .titlebar > stack > headerbar:not(.selection-mode),
.maximized headerbar:last-child:not(.selection-mode),
.maximized .titlebar:last-child:not(.selection-mode),
.maximized .windowhandle:not(.selection-mode) {
  padding-right: 0;
}
.maximized headerbar > box.right,
.maximized .titlebar > box.right {
  margin: 0 -200px 0 0;
  opacity: 0;
}
.maximized .titlebar.default-decoration {
  margin: -200px 0 0;
  opacity: 0;
}
`;

const GTK4_MAXIMIZED_CSS = `
.maximized headerbar windowhandle {
  margin-right: -6px;
}
.maximized headerbar windowcontrols.end {
  margin: 0 -200px 0 0;
  opacity: 0;
}
.maximized .titlebar.default-decoration {
  margin: -200px 0 0;
  opacity: 0;
}
`;

// "tiled" mode: hide when tiled
const GTK3_TILED_CSS = `
.tiled > headerbar:not(.selection-mode),
.tiled > .titlebar:not(.selection-mode),
.tiled > headerbar > headerbar:not(.selection-mode),
.tiled > .titlebar > .titlebar:not(.selection-mode),
.tiled > .titlebar > stack > headerbar:not(.selection-mode),
.tiled headerbar:last-child:not(.selection-mode),
.tiled .titlebar:last-child:not(.selection-mode),
.tiled .windowhandle:not(.selection-mode) {
  padding-right: 0;
}
.tiled headerbar > box.right,
.tiled .titlebar > box.right {
  margin: 0 -200px 0 0;
  opacity: 0;
}
.tiled .titlebar.default-decoration {
  margin: -200px 0 0;
  opacity: 0;
}
`;

const GTK4_TILED_CSS = `
.tiled headerbar windowhandle {
  margin-right: -6px;
}
.tiled headerbar windowcontrols.end {
  margin: 0 -200px 0 0;
  opacity: 0;
}
.tiled .titlebar.default-decoration {
  margin: -200px 0 0;
  opacity: 0;
}
`;

// "always" mode: always hide
const GTK3_ALWAYS_CSS = `
window > headerbar:not(.selection-mode),
window > .titlebar:not(.selection-mode),
window > headerbar > headerbar:not(.selection-mode),
window > .titlebar > .titlebar:not(.selection-mode),
window > .titlebar > stack > headerbar:not(.selection-mode),
window headerbar:last-child:not(.selection-mode),
window .titlebar:last-child:not(.selection-mode),
window .windowhandle:not(.selection-mode) {
  padding-right: 0;
}
window headerbar > box.right,
window .titlebar > box.right {
  margin: 0 -200px 0 0;
  opacity: 0;
}
window .titlebar.default-decoration {
  margin: -200px 0 0;
  opacity: 0;
}
`;

const GTK4_ALWAYS_CSS = `
window headerbar windowhandle {
  margin-right: -6px;
}
window headerbar windowcontrols.end {
  margin: 0 -200px 0 0;
  opacity: 0;
}
window .titlebar.default-decoration {
  margin: -200px 0 0;
  opacity: 0;
}
`;

export class TitleBarManager {
  constructor(settings) {
    this._settings = settings;
    this._enabled = false;
    this._onTitlebarHidden = null;
    this._onTitlebarShown = null;

    this._windows = new Map();
    this._displaySignals = [];

    this._settingId = this._settings.connect('changed::hide-titlebar', () => this._sync());
    this._settingModeId = this._settings.connect('changed::titlebar-hide-mode', () => this._sync());
  }

  set onTitlebarHidden(cb) { this._onTitlebarHidden = cb; }
  set onTitlebarShown(cb) { this._onTitlebarShown = cb; }

  enable() {
    if (this._enabled) return;
    this._enabled = true;
    log('[OneSwitch] titlebar: enable');

    // 1. Inject GTK CSS (handles CSD Wayland apps)
    this._injectGtkStyles();

    // 2. Connect display signals
    this._displaySignals = [
      global.display.connect('window-created', (_d, win) => this._trackWindow(win)),
      global.display.connect('notify::focus-window', () => this._onFocusChanged()),
    ];

    // 3. Register existing windows
    for (const actor of global.get_window_actors()) {
      try { this._trackWindow(actor.get_meta_window()); } catch (_) {}
    }
  }

  disable() {
    if (!this._enabled) return;
    this._enabled = false;
    log('[OneSwitch] titlebar: disable');

    // 1. Remove GTK CSS
    this._removeGtkStyles();

    // 2. Disconnect display signals
    for (const id of this._displaySignals) {
      global.display.disconnect(id);
    }
    this._displaySignals = [];

    // 3. Restore all tracked windows
    for (const [win, state] of this._windows) {
      if (state.signalId) { try { win.disconnect(state.signalId); } catch (_) {} }
      if (state.titleId) { try { win.disconnect(state.titleId); } catch (_) {} }
      if (state.unmanagedId) { try { win.disconnect(state.unmanagedId); } catch (_) {} }
      if (state.hidden) this._showDecorations(win, state);
    }
    this._windows.clear();
  }

  destroy() {
    this.disable();
    if (this._settingId) { this._settings.disconnect(this._settingId); this._settingId = null; }
    if (this._settingModeId) { this._settings.disconnect(this._settingModeId); this._settingModeId = null; }
    this._onTitlebarHidden = null;
    this._onTitlebarShown = null;
  }

  // ----------------------------------------------------------------
  //  GTK CSS injection — PRIMARY mechanism for CSD Wayland apps
  //  GTK monitors ~/.config/gtk-3.0/gtk.css via inotify live
  // ----------------------------------------------------------------

  _userStylesPath(version) {
    return GLib.build_filenamev([GLib.get_user_config_dir(), `gtk-${version}.0`, 'gtk.css']);
  }

  _fileGetContents(path) {
    try {
      const [ok, bytes] = GLib.file_get_contents(path);
      if (ok) return new TextDecoder('utf-8').decode(bytes);
    } catch (_) {}
    return '';
  }

  _fileSetContents(path, contents) {
    try {
      GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
      GLib.file_set_contents(path, contents);
    } catch (e) {
      log(`[OneSwitch] titlebar: write ${path} failed: ${e}`);
    }
  }

  _getCss() {
    const mode = this._settings.get_string('titlebar-hide-mode');
    switch (mode) {
      case 'always': return { gtk3: GTK3_ALWAYS_CSS, gtk4: GTK4_ALWAYS_CSS };
      case 'tiled':  return { gtk3: GTK3_TILED_CSS, gtk4: GTK4_TILED_CSS };
      case 'maximized':
      default:       return { gtk3: GTK3_MAXIMIZED_CSS, gtk4: GTK4_MAXIMIZED_CSS };
    }
  }

  _injectGtkStyles() {
    const { gtk3, gtk4 } = this._getCss();

    for (const ver of GTK_VERSIONS) {
      const fp = this._userStylesPath(ver);
      let style = this._fileGetContents(fp);

      style = style.replace(/\/\* ONESWITCH_TITLEBAR [\s\S]*? ONESWITCH_TITLEBAR \*\/\n?/g, '');

      const css = ver === 3 ? gtk3 : gtk4;
      style = `/* ONESWITCH_TITLEBAR */\n${css}\n/* ONESWITCH_TITLEBAR */\n` + style;
      this._fileSetContents(fp, style);
    }
    log('[OneSwitch] titlebar: GTK CSS injected');
  }

  _removeGtkStyles() {
    for (const ver of GTK_VERSIONS) {
      const fp = this._userStylesPath(ver);
      const style = this._fileGetContents(fp);
      const cleaned = style.replace(/\/\* ONESWITCH_TITLEBAR [\s\S]*? ONESWITCH_TITLEBAR \*\/\n?/g, '');
      if (cleaned !== style) this._fileSetContents(fp, cleaned);
    }
    log('[OneSwitch] titlebar: GTK CSS removed');
  }

  // ----------------------------------------------------------------
  //  Per-window tracking (for SSD/X11 + signal callbacks)
  // ----------------------------------------------------------------

  _trackWindow(win) {
    if (win.get_window_type() !== Meta.WindowType.NORMAL) return;
    if (win.is_skip_taskbar()) return;
    if (this._windows.has(win)) return;

    const state = {
      win,
      hidden: false,
      wasDecorated: null,
      signalId: win.connect('size-changed', () => {
        this._updateWindow(win);
        this._onWindowSizeChanged(win);
      }),
      titleId: win.connect('notify::title', () => {
        this._onWindowTitleChanged(win);
      }),
      unmanagedId: win.connect('unmanaged', () => {
        this._windows.delete(win);
      }),
    };

    this._windows.set(win, state);
    this._updateWindow(win);
  }

  _onWindowSizeChanged(win) {
    if (!this._enabled) return;
    // On size change, re-evaluate — might have been maximized/tiled
    // Notify panel-title if focused
    if (win.has_focus && win.has_focus()) {
      const state = this._windows.get(win);
      if (state && this._onTitlebarHidden) {
        if (state.hidden) this._onTitlebarHidden(win);
        else this._onTitlebarShown(win);
      }
    }
  }

  _onWindowTitleChanged(win) {
    // Title changed — notify panel-title so it can update the label
    if (win.has_focus && win.has_focus()) {
      const state = this._windows.get(win);
      if (state && state.hidden && this._onTitlebarHidden)
        this._onTitlebarHidden(win);
    }
  }

  _onFocusChanged() {
    const win = global.display.get_focus_window();
    if (win && this._windows.has(win)) {
      const state = this._windows.get(win);
      if (state.hidden && this._onTitlebarHidden) this._onTitlebarHidden(win);
      else if (!state.hidden && this._onTitlebarShown) this._onTitlebarShown(win);
    }
  }

  _shouldHide(win) {
    if (!this._enabled) return false;
    if (!this._settings.get_boolean('hide-titlebar')) return false;
    if (win.is_fullscreen()) return false;
    if (win.is_minimized()) return false;

    const mode = this._settings.get_string('titlebar-hide-mode');
    if (mode === 'always') return true;

    const maxH = win.get_maximized_horizontally();
    const maxV = win.get_maximized_vertically();

    if (mode === 'maximized') return maxH && maxV;
    if (mode === 'tiled') return maxH || maxV;

    return false;
  }

  _updateWindow(win) {
    if (!this._enabled) return;
    if (!this._windows.has(win)) { this._trackWindow(win); return; }

    const state = this._windows.get(win);
    const shouldHide = this._shouldHide(win);

    if (shouldHide && !state.hidden) {
      this._hideDecorations(win, state);
    } else if (!shouldHide && state.hidden) {
      this._showDecorations(win, state);
    }
  }

  // ----------------------------------------------------------------
  //  Decoration operations
  // ----------------------------------------------------------------

  _isClientDecorated(win) {
    try {
      if (win.is_client_decorated) return win.is_client_decorated();
    } catch (_) {}
    try {
      return win.get_client_type() === Meta.WindowClientType.WAYLAND;
    } catch (_) {}
    return false;
  }

  _hideDecorations(win, state) {
    try {
      if (state.wasDecorated === null)
        state.wasDecorated = win.decorated;

      // For CSD (Wayland GTK) apps: CSS injection handles the visual hiding.
      // We also send the protocol hint as a secondary measure.
      try { win.set_gtk_hide_titlebar_when_maximized(true); } catch (_) {}

      // For SSD (X11/XWayland): use Motif hints via xprop (same as Unite)
      if (!this._isClientDecorated(win)) {
        this._setMotifHints(win, false);
        try { win.decorated = false; } catch (_) {}
      }

      state.hidden = true;
      if (win.has_focus && win.has_focus() && this._onTitlebarHidden)
        this._onTitlebarHidden(win);

      log(`[OneSwitch] titlebar: hid "${win.get_title()}"`);
    } catch (e) {
      log(`[OneSwitch] titlebar: hide failed: ${e}`);
    }
  }

  _showDecorations(win, state) {
    try {
      try { win.set_gtk_hide_titlebar_when_maximized(false); } catch (_) {}

      if (!this._isClientDecorated(win)) {
        this._setMotifHints(win, true);
        try { if (state.wasDecorated !== null) win.decorated = state.wasDecorated; } catch (_) {}
      }

      state.hidden = false;
      if (win.has_focus && win.has_focus() && this._onTitlebarShown)
        this._onTitlebarShown(win);
    } catch (e) {
      log(`[OneSwitch] titlebar: restore failed: ${e}`);
    }
  }

  _getXid(win) {
    const desc = win.get_description();
    const match = desc && desc.match(/0x[0-9a-f]+/);
    return match && match[0];
  }

  _setMotifHints(win, show) {
    const xid = this._getXid(win);
    if (!xid) return;
    const flags = show ? _SHOW_FLAGS : _HIDE_FLAGS;
    Util.spawn(['xprop', '-id', xid, '-f', MOTIF_HINTS, '32c', '-set', MOTIF_HINTS, flags.join(', ')]);
  }

  // ----------------------------------------------------------------
  //  Sync
  // ----------------------------------------------------------------

  _sync() {
    if (this._enabled) {
      this._removeGtkStyles();
      this._injectGtkStyles();
      for (const [win] of this._windows) this._updateWindow(win);
    }
  }
}