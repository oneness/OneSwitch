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
      subtitle: currentLabel(settings) || 'Disabled — click Record',
    });
    const button = new Gtk.Button({ label: 'Record', valign: Gtk.Align.CENTER });
    row.add_suffix(button);
    group.add(row);
    window.add(page);

    // Keep subtitle in sync whenever the setting changes (including after recording).
    settings.connect('changed::hotkey', () => {
      row.set_subtitle(currentLabel(settings) || 'Disabled — click Record');
    });

    button.connect('clicked', () => {
      const previous = current(settings);
      // Clear the hotkey so the extension drops the global binding — otherwise
      // the shell intercepts the key combo before this window can capture it.
      settings.set_strv('hotkey', ['']);
      button.set_label('Press a combo…');
      const ctl = new Gtk.EventControllerKey();
      // CAPTURE phase: fires before any child widget handles the event.
      ctl.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
      window.add_controller(ctl);
      ctl.connect('key-pressed', (_c, keyval, _code, state) => {
        // Ignore lone modifier presses (Shift, Ctrl, Alt, AltGr, Super, …).
        // Gdk.keyval_is_modifier() is unavailable in some GJS builds; use ranges.
        if (isModifier(keyval)) return true;
        if (keyval === Gdk.KEY_Escape) {
          // Restore previous binding on cancel.
          if (previous) settings.set_strv('hotkey', [previous]);
          reset();
          window.remove_controller(ctl);
          return true;
        }
        const mods = state & Gtk.accelerator_get_default_mod_mask();
        const accel = Gtk.accelerator_name(keyval, mods);
        // Save the accelerator; the settings listener above updates the subtitle.
        settings.set_strv('hotkey', [accel]);
        reset();
        window.remove_controller(ctl);
        return true;
      });
      function reset() { button.set_label('Record'); }
    });
  }
}

function isModifier(keyval) {
  // Standard modifier keysyms: Shift_L/R, Control_L/R, Caps_Lock, Shift_Lock,
  // Meta_L/R, Alt_L/R, Super_L/R, Hyper_L/R are all in 0xFFE1–0xFFEE.
  if (keyval >= 0xFFE1 && keyval <= 0xFFEE) return true;
  // ISO level-shift (AltGr = 0xFE03), Mode_switch (0xFF7E), Num_Lock (0xFF7F).
  if (keyval === 0xFE03 || keyval === 0xFE11 || keyval === 0xFF7E || keyval === 0xFF7F) return true;
  return false;
}

function current(settings) {
  const v = settings.get_strv('hotkey');
  return v && v.length ? v[0] : '';
}

// Returns a human-readable label (e.g. "Ctrl+Alt+S") from the stored accelerator.
// AdwActionRow.subtitle is Pango markup, so raw "<Primary><Alt>s" would be invisible.
function currentLabel(settings) {
  const accel = current(settings);
  if (!accel) return '';
  try {
    const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
    if (ok && keyval) return Gtk.accelerator_get_label(keyval, mods);
  } catch (_) {}
  return accel;
}
