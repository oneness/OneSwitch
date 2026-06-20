import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export const OneSwitchIndicator = GObject.registerClass(
class OneSwitchIndicator extends PanelMenu.Button {
  _init(onOpen, onPrefs, onToggleTitlebar) {
    super._init(0.0, 'OneSwitch');
    this.add_child(new St.Icon({
      icon_name: 'view-app-grid-symbolic',
      style_class: 'system-status-icon',
    }));

    const open = new PopupMenu.PopupMenuItem('Open switcher');
    open.connect('activate', () => onOpen());
    this.menu.addMenuItem(open);

    this._titlebarItem = new PopupMenu.PopupMenuItem('Hide title bars');
    this._titlebarItem.connect('activate', () => {
      if (onToggleTitlebar) onToggleTitlebar();
    });
    this.menu.addMenuItem(this._titlebarItem);

    const prefs = new PopupMenu.PopupMenuItem('Preferences');
    prefs.connect('activate', () => onPrefs());
    this.menu.addMenuItem(prefs);
  }

  setTitlebarActive(active) {
    this._titlebarItem.label.text = active ? 'Show title bars' : 'Hide title bars';
  }
});