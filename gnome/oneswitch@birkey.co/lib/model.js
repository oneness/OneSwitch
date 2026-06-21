// Pure search/ranking. No GNOME imports so Node can unit-test it.

function scoreItem(title, appName, tokens) {
  let score = 0;
  for (const t of tokens) {
    const inTitle = title.includes(t);
    const inApp = appName.includes(t);
    if (inTitle) score += 10;
    else if (inApp) score += 4;
    if (title.startsWith(t)) score += 6;
    if (new RegExp(`\\b${escapeRe(t)}`).test(title)) score += 3;
  }
  return score;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function filterAndRank(items, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return items.slice();
  const tokens = q.split(/\s+/);
  const scored = [];
  for (const it of items) {
    const title = (it.title || '').toLowerCase();
    const app = (it.appName || '').toLowerCase();
    const hay = `${title} ${app}`;
    if (!tokens.every(t => hay.includes(t))) continue;
    scored.push({ item: it, score: scoreItem(title, app, tokens) });
  }
  scored.sort((a, b) =>
    b.score - a.score ||
    (a.item.title || '').length - (b.item.title || '').length);
  return scored.map(s => s.item);
}

// Windows always show; apps only while searching, ranked after windows.
export function composeResults(windows, apps, query) {
  const w = filterAndRank(windows, query);
  if (!(query || '').trim()) return w;
  const a = filterAndRank(apps, query);
  return w.concat(a);
}
