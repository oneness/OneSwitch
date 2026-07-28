import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SwitcherPopup } from './lib/switcher.js';
import { OneSwitchIndicator } from './lib/indicator.js';
import { Inhibitor } from './lib/inhibitor.js';
import { TitleBarManager } from './lib/titlebar.js';
import { PanelTitleWidget } from './lib/panel-title.js';

export default class OneSwitchExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._popup = new SwitcherPopup();

    // Keep awake — holds a session-manager inhibitor
    this._inhibitor = new Inhibitor(
      this.uuid,
      (active) => this._indicator?.setKeepAwake(active));

    // Indicator (right side)
    this._indicator = new OneSwitchIndicator(
      this.path,
      () => this._popup.toggle(),
      () => this.openPreferences(),
      (active) => this._inhibitor.setActive(active));
    Main.panel.addToStatusArea('oneswitch', this._indicator, 1);

    // Title bar feature
    this._titlebar = new TitleBarManager(this._settings);
    this._panelTitle = null;

    if (this._settings.get_boolean('hide-titlebar')) {
      this._enableTitlebarFeature();
    }

    this._hideSettingId = this._settings.connect('changed::hide-titlebar', () => {
      if (this._settings.get_boolean('hide-titlebar'))
        this._enableTitlebarFeature();
      else
        this._disableTitlebarFeature();
    });

    // Hotkey
    this._bindingRegistered = false;
    this._registerHotkey();
    this._hotkeyChangedId = this._settings.connect('changed::hotkey', () => this._registerHotkey());
  }

  _enableTitlebarFeature() {
    this._titlebar.enable();

    if (!this._panelTitle) {
      this._panelTitle = new PanelTitleWidget(this._titlebar);
      this._panelTitle.setSettings(this._settings);
      Main.panel.addToStatusArea('oneswitch-panel-title', this._panelTitle, 2, 'left');
    }
  }

  _disableTitlebarFeature() {
    this._titlebar.disable();

    if (this._panelTitle) {
      this._panelTitle.destroy();
      this._panelTitle = null;
    }
  }

  _registerHotkey() {
    if (this._bindingRegistered) {
      Main.wm.removeKeybinding('hotkey');
      this._bindingRegistered = false;
    }
    const keys = this._settings.get_strv('hotkey');
    if (!keys.length || !keys[0]) return;
    Main.wm.addKeybinding(
      'hotkey', this._settings,
      Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
      () => this._popup.toggle());
    this._bindingRegistered = true;
  }

  disable() {
    if (this._hotkeyChangedId) { this._settings.disconnect(this._hotkeyChangedId); this._hotkeyChangedId = null; }
    if (this._bindingRegistered) { Main.wm.removeKeybinding('hotkey'); this._bindingRegistered = null; }
    if (this._hideSettingId) { this._settings.disconnect(this._hideSettingId); this._hideSettingId = null; }
    if (this._panelTitle) { this._panelTitle.destroy(); this._panelTitle = null; }
    if (this._titlebar) { this._titlebar.destroy(); this._titlebar = null; }
    if (this._inhibitor) { this._inhibitor.destroy(); this._inhibitor = null; }
    if (this._indicator) { this._indicator.destroy(); this._indicator = null; }
    if (this._popup) { this._popup.destroy(); this._popup = null; }
    this._settings = null;
  }
}