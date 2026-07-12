import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { parseHistory } from './history.js';

export function readHistory() {
  const shellPath = GLib.getenv('SHELL') || '';
  const isZsh = shellPath.endsWith('zsh');
  const home = GLib.get_home_dir();
  const path = isZsh ? `${home}/.zsh_history` : `${home}/.bash_history`;
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) return [];
    const content = new TextDecoder('utf-8').decode(bytes);
    return parseHistory(content, isZsh ? 'zsh' : 'bash');
  } catch (_e) {
    return [];
  }
}

// Executable names on $PATH, deduped and sorted. Commands run via `bash -lc`,
// whose login PATH can differ from gnome-shell's, but in practice they agree
// on the system/profile bin dirs.
export function readPathCommands() {
  const names = new Set();
  for (const dir of (GLib.getenv('PATH') || '').split(':')) {
    if (!dir) continue;
    let en;
    try {
      en = Gio.File.new_for_path(dir).enumerate_children(
        'standard::name', Gio.FileQueryInfoFlags.NONE, null);
    } catch (_e) { continue; }
    let info;
    while ((info = en.next_file(null))) {
      const name = info.get_name();
      if (name.startsWith('.') || names.has(name)) continue; // '.foo-wrapped' Nix internals
      const p = `${dir}/${name}`;
      if (GLib.file_test(p, GLib.FileTest.IS_EXECUTABLE) && !GLib.file_test(p, GLib.FileTest.IS_DIR))
        names.add(name);
    }
    en.close(null);
  }
  return [...names].sort();
}
