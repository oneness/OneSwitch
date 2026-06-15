import Gio from 'gi://Gio';

// Installed apps (that pass should_show) which are NOT in openIds.
// openIds is a Set of desktop ids ("firefox.desktop").
export function listApps(openIds) {
  const out = [];
  for (const info of Gio.AppInfo.get_all()) {
    if (!info.should_show()) continue;
    const id = info.get_id();
    if (openIds.has(id)) continue;
    out.push({
      id: `app-${id}`,
      kind: 'app',
      title: info.get_display_name() || info.get_name() || '',
      appName: '',
      gicon: info.get_icon(),
      appInfo: info,
    });
  }
  return out;
}

export function launch(appInfo) {
  const ctx = global.create_app_launch_context(0, -1);
  appInfo.launch([], ctx);
}
