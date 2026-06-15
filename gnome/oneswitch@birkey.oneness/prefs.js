import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class OneSwitchPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({ title: 'Hotkey' });
    page.add(group);

    const row = new Adw.ActionRow({
      title: 'Open switcher',
      subtitle: current(settings) || 'Disabled — click Record',
    });
    const button = new Gtk.Button({ label: 'Record', valign: Gtk.Align.CENTER });
    row.add_suffix(button);
    group.add(row);
    window.add(page);

    button.connect('clicked', () => {
      button.set_label('Press a combo…');
      const ctl = new Gtk.EventControllerKey();
      window.add_controller(ctl);
      ctl.connect('key-pressed', (_c, keyval, _code, state) => {
        const mods = state & Gtk.accelerator_get_default_mod_mask();
        if (keyval === Gdk.KEY_Escape) { reset(); window.remove_controller(ctl); return true; }
        // Ignore lone modifier presses.
        if ([Gdk.KEY_Control_L, Gdk.KEY_Control_R, Gdk.KEY_Shift_L,
             Gdk.KEY_Shift_R, Gdk.KEY_Alt_L, Gdk.KEY_Super_L].includes(keyval)) return true;
        const accel = Gtk.accelerator_name(keyval, mods);
        settings.set_strv('hotkey', [accel]);
        row.set_subtitle(accel);
        reset();
        window.remove_controller(ctl);
        return true;
      });
      function reset() { button.set_label('Record'); }
    });
  }
}

function current(settings) {
  const v = settings.get_strv('hotkey');
  return v && v.length ? v[0] : '';
}
