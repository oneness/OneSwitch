import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export const OneSwitchIndicator = GObject.registerClass(
class OneSwitchIndicator extends PanelMenu.Button {
  _init(extensionPath, onOpen, onPrefs, onKeepAwake) {
    super._init(0.0, 'OneSwitch');
    this.add_style_class_name('oneswitch-indicator');

    const gicon = Gio.icon_new_for_string(extensionPath + '/icons/oneswitch-symbolic.svg');
    this._icon = new St.Icon({
      gicon,
      style_class: 'system-status-icon',
      icon_size: 16,
    });
    this.add_child(this._icon);

    const open = new PopupMenu.PopupMenuItem('Open switcher');
    open.connect('activate', () => onOpen());
    this.menu.addMenuItem(open);

    this._keepAwake = new PopupMenu.PopupSwitchMenuItem('Keep awake', false);
    this._keepAwake.connect('toggled', (_item, state) => onKeepAwake(state));
    this.menu.addMenuItem(this._keepAwake);

    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const prefs = new PopupMenu.PopupMenuItem('Preferences');
    prefs.connect('activate', () => onPrefs());
    this.menu.addMenuItem(prefs);
  }

  // Reflect inhibitor state: menu switch plus a tinted panel icon, so it is
  // visible without opening the menu.
  setKeepAwake(active) {
    this._keepAwake.setToggleState(active);
    if (active) this._icon.add_style_class_name('oneswitch-icon-awake');
    else this._icon.remove_style_class_name('oneswitch-icon-awake');
  }
});
