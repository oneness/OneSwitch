import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class OneSwitchPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    // ---- Hotkey page ----
    const hotkeyPage = new Adw.PreferencesPage({ title: 'Hotkey' });
    const hotkeyGroup = new Adw.PreferencesGroup({ title: 'Hotkey' });
    hotkeyPage.add(hotkeyGroup);

    const hotkeyRow = new Adw.ActionRow({
      title: 'Open switcher',
      subtitle: currentLabel(settings) || 'Disabled — click Record',
    });
    const recordBtn = new Gtk.Button({ label: 'Record', valign: Gtk.Align.CENTER });
    hotkeyRow.add_suffix(recordBtn);
    hotkeyGroup.add(hotkeyRow);
    window.add(hotkeyPage);

    settings.connect('changed::hotkey', () => {
      hotkeyRow.set_subtitle(currentLabel(settings) || 'Disabled — click Record');
    });

    recordBtn.connect('clicked', () => {
      const previous = current(settings);
      settings.set_strv('hotkey', ['']);
      recordBtn.set_label('Press a combo…');
      const ctl = new Gtk.EventControllerKey();
      ctl.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
      window.add_controller(ctl);
      ctl.connect('key-pressed', (_c, keyval, _code, state) => {
        if (isModifier(keyval)) return true;
        if (keyval === Gdk.KEY_Escape) {
          if (previous) settings.set_strv('hotkey', [previous]);
          reset();
          window.remove_controller(ctl);
          return true;
        }
        const mods = state & Gtk.accelerator_get_default_mod_mask();
        const accel = Gtk.accelerator_name(keyval, mods);
        settings.set_strv('hotkey', [accel]);
        reset();
        window.remove_controller(ctl);
        return true;
      });
      function reset() { recordBtn.set_label('Record'); }
    });

    // ---- Title bar page ----
    const titlePage = new Adw.PreferencesPage({ title: 'Title Bar' });
    const titleGroup = new Adw.PreferencesGroup({
      title: 'Window Title Bar',
      description: 'Hide title bars on maximized windows and show the title in the top panel.',
    });
    titlePage.add(titleGroup);

    // Master toggle
    const masterRow = new Adw.ActionRow({ title: 'Hide title bar' });
    const masterSwitch = new Gtk.Switch({
      active: settings.get_boolean('hide-titlebar'),
      valign: Gtk.Align.CENTER,
    });
    masterRow.add_suffix(masterSwitch);
    titleGroup.add(masterRow);

    const syncSensitivity = () => {
      const active = masterSwitch.active;
      modeCombo.sensitive = active;
      showTitleSwitch.sensitive = active;
      showButtonsSwitch.sensitive = active;
    };

    masterSwitch.connect('notify::active', () => {
      settings.set_boolean('hide-titlebar', masterSwitch.active);
      syncSensitivity();
    });

    // Hide mode
    const modeRow = new Adw.ActionRow({ title: 'Hide mode', subtitle: 'When to hide the title bar' });
    const modeCombo = new Gtk.ComboBoxText({
      valign: Gtk.Align.CENTER,
      sensitive: settings.get_boolean('hide-titlebar'),
    });
    modeCombo.append('maximized', 'When maximized');
    modeCombo.append('tiled', 'When tiled or maximized');
    modeCombo.append('always', 'Always');
    const curMode = settings.get_string('titlebar-hide-mode');
    modeCombo.set_active_id(curMode || 'maximized');
    modeRow.add_suffix(modeCombo);
    titleGroup.add(modeRow);

    modeCombo.connect('changed', () => {
      settings.set_string('titlebar-hide-mode', modeCombo.get_active_id());
    });

    // Show window title in panel
    const showTitleRow = new Adw.ActionRow({ title: 'Show window title in panel' });
    const showTitleSwitch = new Gtk.Switch({
      active: settings.get_boolean('panel-show-title'),
      valign: Gtk.Align.CENTER,
      sensitive: settings.get_boolean('hide-titlebar'),
    });
    showTitleRow.add_suffix(showTitleSwitch);
    titleGroup.add(showTitleRow);

    showTitleSwitch.connect('notify::active', () => {
      settings.set_boolean('panel-show-title', showTitleSwitch.active);
    });

    // Show window buttons in panel
    const showButtonsRow = new Adw.ActionRow({ title: 'Show window buttons in panel' });
    const showButtonsSwitch = new Gtk.Switch({
      active: settings.get_boolean('panel-show-buttons'),
      valign: Gtk.Align.CENTER,
      sensitive: settings.get_boolean('hide-titlebar'),
    });
    showButtonsRow.add_suffix(showButtonsSwitch);
    titleGroup.add(showButtonsRow);

    showButtonsSwitch.connect('notify::active', () => {
      settings.set_boolean('panel-show-buttons', showButtonsSwitch.active);
    });

    window.add(titlePage);
  }
}

function isModifier(keyval) {
  if (keyval >= 0xFFE1 && keyval <= 0xFFEE) return true;
  if (keyval === 0xFE03 || keyval === 0xFE11 || keyval === 0xFF7E || keyval === 0xFF7F) return true;
  return false;
}

function current(settings) {
  const v = settings.get_strv('hotkey');
  return v && v.length ? v[0] : '';
}

function currentLabel(settings) {
  const accel = current(settings);
  if (!accel) return '';
  try {
    const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
    if (ok && keyval) return Gtk.accelerator_get_label(keyval, mods);
  } catch (_) {}
  return accel;
}