// Pure. Given MRU-ordered items and the focused window id, pick the initial
// selection: the previous (next most-recent) window. Falls back to 0.

export function preselectIndex(items, focusedId) {
  if (!items || items.length === 0) return 0;
  if (focusedId === null || focusedId === undefined) return 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].windowId !== focusedId) return i;
  }
  return 0;
}
