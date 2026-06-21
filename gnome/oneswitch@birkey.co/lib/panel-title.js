// Panel Title Widget — shows the focused window's title and window controls
// in the GNOME top panel when the titlebar is hidden.
//
// Follows the Unite extension pattern: PanelMenu.Button subclass
// with non-reactive behavior (no menu), inserted into the left panel box.

import GObject from 'gi://GObject';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export const PanelTitleWidget = GObject.registerClass(
class PanelTitleWidget extends PanelMenu.Button {
  _init(titleBarManager) {
    super._init(0.0, 'OneSwitch Panel Title', false);

    this._manager = titleBarManager;
    this._focusedWin = null;
    this._settings = null;
    this._showTitleId = 0;
    this._showButtonsId = 0;

    // Non-reactive: clicking does nothing, no menu
    this.reactive = false;

    // Main container
    const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
    this.add_child(box);

    // Window title label
    this._titleLabel = new St.Label({
      style_class: 'oneswitch-panel-title-label',
      text: '',
      y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(this._titleLabel);

    // Spacer
    this._spacer = new St.BoxLayout({ x_expand: true });
    box.add_child(this._spacer);

    // Window buttons
    this._buttonsBox = new St.BoxLayout({
      style_class: 'oneswitch-panel-title-buttons',
      visible: false,
    });
    box.add_child(this._buttonsBox);

    // Close button
    this._closeBtn = this._makeButton('window-close-symbolic', () => {
      if (this._focusedWin)
        this._focusedWin.delete(global.get_current_time());
    });
    this._buttonsBox.add_child(this._closeBtn);

    // Minimize button
    this._minBtn = this._makeButton('window-minimize-symbolic', () => {
      if (this._focusedWin) this._focusedWin.minimize();
    });
    this._buttonsBox.add_child(this._minBtn);

    // Maximize/restore button
    this._maxBtn = this._makeButton('window-maximize-symbolic', () => {
      if (!this._focusedWin) return;
      if (this._focusedWin.maximized_horizontally && this._focusedWin.maximized_vertically)
        this._focusedWin.unmaximize(Meta.MaximizeFlags.BOTH);
      else
        this._focusedWin.maximize(Meta.MaximizeFlags.BOTH);
    });
    this._buttonsBox.add_child(this._maxBtn);

    // Focus tracking
    this._focusId = global.display.connect('notify::focus-window', () => {
      this._update();
    });

    // Callbacks from TitleBarManager
    titleBarManager.onTitlebarHidden = (win) => {
      if (win === this._focusedWin) this._update();
    };
    titleBarManager.onTitlebarShown = (win) => {
      if (win === this._focusedWin) this._update();
    };

    // Start hidden
    this.visible = false;
    this._update();
  }

  _makeButton(iconName, callback) {
    const btn = new St.Button({
      style_class: 'oneswitch-panel-title-button',
      reactive: true,
      can_focus: true,
      track_hover: true,
    });
    btn.set_child(new St.Icon({
      icon_name: iconName,
      icon_size: 12,
      style_class: 'oneswitch-panel-title-button-icon',
    }));
    btn.connect('clicked', () => callback());
    return btn;
  }

  setSettings(settings) {
    this._settings = settings;
    if (settings) {
      if (this._showTitleId) settings.disconnect(this._showTitleId);
      if (this._showButtonsId) settings.disconnect(this._showButtonsId);
      this._showTitleId = settings.connect('changed::panel-show-title', () => this._update());
      this._showButtonsId = settings.connect('changed::panel-show-buttons', () => this._update());
    }
  }

  _update() {
    this._focusedWin = global.display.get_focus_window();
    const win = this._focusedWin;

    if (!win) {
      this.visible = false;
      return;
    }

    // Only show when hide-titlebar is enabled
    if (!this._settings?.get_boolean('hide-titlebar')) {
      this.visible = false;
      return;
    }

    // Only show when the window SHOULD have its titlebar hidden
    if (!this._windowShouldHide(win)) {
      this.visible = false;
      return;
    }

    // Show title
    const showTitle = this._settings?.get_boolean('panel-show-title') ?? true;
    this._titleLabel.visible = showTitle;
    if (showTitle) {
      this._titleLabel.set_text(win.get_title() || '');
    }

    // Update maximize/restore icon
    const isMaximized = win.maximized_horizontally && win.maximized_vertically;
    this._maxBtn.child.icon_name = isMaximized
      ? 'window-restore-symbolic'
      : 'window-maximize-symbolic';

    // Button sensitivity
    this._closeBtn.reactive = true;
    this._minBtn.reactive = win.can_minimize();
    this._maxBtn.reactive = win.can_maximize();

    // Show buttons based on setting
    this._buttonsBox.visible = this._settings?.get_boolean('panel-show-buttons') ?? true;

    this.visible = true;
  }

  _windowShouldHide(win) {
    if (!win) return false;
    if (win.fullscreen) return false;
    if (win.minimized) return false;

    const mode = this._settings?.get_string('titlebar-hide-mode') ?? 'maximized';
    if (mode === 'always') return true;

    const maxH = win.maximized_horizontally;
    const maxV = win.maximized_vertically;

    if (mode === 'maximized') return maxH && maxV;
    if (mode === 'tiled') return maxH || maxV;

    return false;
  }

  destroy() {
    if (this._focusId) {
      global.display.disconnect(this._focusId);
      this._focusId = null;
    }
    if (this._settings) {
      if (this._showTitleId) { this._settings.disconnect(this._showTitleId); this._showTitleId = null; }
      if (this._showButtonsId) { this._settings.disconnect(this._showButtonsId); this._showButtonsId = null; }
    }
    this._focusedWin = null;
    this._manager = null;
    this._settings = null;
    super.destroy();
  }
});