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
