// Pure parsing/matching — no GNOME imports so Node can unit-test it.

export function parseHistory(content, shell) {
  let lines = (content || '').split('\n');
  if (shell === 'zsh') lines = lines.map(l => l.replace(/^: \d+:\d+;/, ''));
  const seen = new Set();
  const out = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const c = lines[i].trim();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

export function matchHistory(entries, fragment) {
  const f = (fragment || '').trim().toLowerCase();
  if (!f) return entries.slice();
  return entries.filter(e => e.toLowerCase().includes(f));
}

// Merge history matches with PATH executables: history first (personalized,
// full command lines), then matching executable names — prefix matches before
// substring matches, capped so a broad fragment can't flood the list. An
// executable identical to a listed history entry is dropped as a duplicate.
// Empty fragment lists history only.
export const MAX_PATH_COMMANDS = 30;

export function matchCommands(history, executables, fragment) {
  const out = matchHistory(history, fragment).map(cmd => ({ cmd, source: 'history' }));
  const f = (fragment || '').trim().toLowerCase();
  if (!f) return out;
  const seen = new Set(out.map(e => e.cmd));
  const prefix = [], substr = [];
  for (const name of executables) {
    if (seen.has(name)) continue;
    const n = name.toLowerCase();
    if (n.startsWith(f)) prefix.push(name);
    else if (n.includes(f)) substr.push(name);
  }
  for (const name of prefix.concat(substr).slice(0, MAX_PATH_COMMANDS))
    out.push({ cmd: name, source: 'path' });
  return out;
}
