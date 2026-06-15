import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function listWindows() {
  const tracker = Shell.WindowTracker.get_default();
  const wins = global.display.get_tab_list(Meta.TabList.NORMAL, null);
  const items = [];
  for (const w of wins) {
    if (w.get_window_type() !== Meta.WindowType.NORMAL) continue;
    if (w.is_skip_taskbar()) continue;
    const app = tracker.get_window_app(w);
    items.push({
      id: `win-${w.get_id()}`,
      kind: 'window',
      title: w.get_title() || '',
      appName: app ? app.get_name() : '',
      windowId: w.get_id(),
      metaWindow: w,
      app,
    });
  }
  return items;
}

export function focusedWindowId() {
  const w = global.display.get_focus_window();
  return w ? w.get_id() : null;
}

export function activate(metaWindow) {
  Main.activateWindow(metaWindow);
}

// Desktop ids ("firefox.desktop") of apps that currently have a window open.
export function openAppIds() {
  const tracker = Shell.WindowTracker.get_default();
  const ids = new Set();
  for (const w of global.display.get_tab_list(Meta.TabList.NORMAL, null)) {
    const app = tracker.get_window_app(w);
    if (app) ids.add(app.get_id());
  }
  return ids;
}
