import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export const OneSwitchIndicator = GObject.registerClass(
class OneSwitchIndicator extends PanelMenu.Button {
  _init(extensionPath, onOpen, onPrefs) {
    super._init(0.0, 'OneSwitch');
    this.add_style_class_name('oneswitch-indicator');

    const gicon = Gio.icon_new_for_string(extensionPath + '/icons/oneswitch-symbolic.svg');
    this.add_child(new St.Icon({
      gicon,
      style_class: 'system-status-icon',
      icon_size: 16,
    }));

    const open = new PopupMenu.PopupMenuItem('Open switcher');
    open.connect('activate', () => onOpen());
    this.menu.addMenuItem(open);

    const prefs = new PopupMenu.PopupMenuItem('Preferences');
    prefs.connect('activate', () => onPrefs());
    this.menu.addMenuItem(prefs);
  }
});
