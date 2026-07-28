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

    this._giconIdle = Gio.icon_new_for_string(extensionPath + '/icons/oneswitch.svg');
    this._giconAwake = Gio.icon_new_for_string(extensionPath + '/icons/oneswitch-awake.svg');
    this._icon = new St.Icon({
      gicon: this._giconIdle,
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

  // Reflect inhibitor state: menu switch plus an amber panel icon, so it is
  // visible without opening the menu. Swapping the icon rather than tinting it via
  // CSS, because the icon is non-symbolic and so St never applies the style colour.
  setKeepAwake(active) {
    this._keepAwake.setToggleState(active);
    this._icon.gicon = active ? this._giconAwake : this._giconIdle;
  }
});
