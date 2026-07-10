// Pure. Detect command mode ("> …") or web-search mode ("? …") vs search mode.
export function parseQuery(text) {
  const t = text || '';
  if (t.startsWith('>')) return { mode: 'command', value: t.slice(1).replace(/^\s+/, '') };
  if (t.startsWith('?')) return { mode: 'web', value: t.slice(1).replace(/^\s+/, '') };
  return { mode: 'search', value: t };
}
