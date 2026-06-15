import GLib from 'gi://GLib';
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
