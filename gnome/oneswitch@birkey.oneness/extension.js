import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SwitcherPopup } from './lib/switcher.js';
import { OneSwitchIndicator } from './lib/indicator.js';

export default class OneSwitchExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._popup = new SwitcherPopup();

    this._indicator = new OneSwitchIndicator(
      () => this._popup.toggle(),
      () => this.openPreferences());
    Main.panel.addToStatusArea('oneswitch', this._indicator);

    this._bindingRegistered = false;
    this._registerHotkey();
    this._hotkeyChangedId = this._settings.connect('changed::hotkey', () => this._registerHotkey());
  }

  _registerHotkey() {
    if (this._bindingRegistered) {
      Main.wm.removeKeybinding('hotkey');
      this._bindingRegistered = false;
    }
    const keys = this._settings.get_strv('hotkey');
    if (!keys.length || !keys[0]) return;
    Main.wm.addKeybinding(
      'hotkey',
      this._settings,
      Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
      () => this._popup.toggle());
    this._bindingRegistered = true;
  }

  disable() {
    if (this._hotkeyChangedId) {
      this._settings.disconnect(this._hotkeyChangedId);
      this._hotkeyChangedId = null;
    }
    if (this._bindingRegistered) {
      Main.wm.removeKeybinding('hotkey');
      this._bindingRegistered = false;
    }
    if (this._indicator) { this._indicator.destroy(); this._indicator = null; }
    if (this._popup) { this._popup.destroy(); this._popup = null; }
    this._settings = null;
  }
}
