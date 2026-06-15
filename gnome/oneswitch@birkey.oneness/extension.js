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
