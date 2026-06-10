import Cocoa

final class AppDelegate: NSObject, NSApplicationDelegate {
    let windowManager = WindowManager()
    private let windowHistory = WindowHistory()
    private var hotKeyManager: HotKeyManager!
    private var switcher: SwitcherPanelController!
    private var statusBar: StatusBarController!

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusBar = StatusBarController()
        switcher = SwitcherPanelController(windowManager: windowManager, history: windowHistory)
        hotKeyManager = HotKeyManager { [weak self] in
            self?.switcher.handleHotkey()
        }
        hotKeyManager.register()

        let trusted = windowManager.ensureAccessibilityPermission()
        // Launch diagnostic: when launched via `open`, stderr is detached, so AppLog also
        // records this to ~/Library/Logs/OneSwitch.log.
        let windows = windowManager.getAccessibilityWindows()
        AppLog.log("launched: accessibility trusted: \(trusted), windows: \(windows.count). Press Control+Tab to open the switcher.")
        if !trusted {
            AppLog.log("Accessibility permission NOT granted — per-window listing will be limited. Grant it in System Settings ▸ Privacy & Security ▸ Accessibility, then relaunch.")
        }
    }
}

// Diagnostic mode: dump the item list (and any AppleScript errors) to stderr, then exit.
if CommandLine.arguments.contains("--dump") {
    let wm = WindowManager()
    let trusted = wm.ensureAccessibilityPermission()
    let tabs = wm.getBrowserTabs()
    let windows = wm.getAccessibilityWindows()
    let apps = AppCatalog().apps()
    FileHandle.standardError.write("accessibility trusted: \(trusted), chrome tabs: \(tabs.count), windows: \(windows.count), installed apps: \(apps.count)\n".data(using: .utf8)!)
    for t in tabs { FileHandle.standardError.write("  TAB\(t.isActiveTab ? "*" : " ") \(t.ownerName) [win \(t.chromeWindowId ?? "?") tab \(t.chromeTabId ?? "?")]: \(t.title)\n".data(using: .utf8)!) }
    for w in windows { FileHandle.standardError.write("  WIN \(w.ownerName): \(w.title)\n".data(using: .utf8)!) }
    for a in apps.prefix(10) { FileHandle.standardError.write("  APP \(a.name): \(a.url.path)\n".data(using: .utf8)!) }
    exit(0)
}

// Diagnostic mode: focus a Chrome tab by id (as printed by --dump), then exit.
if let flagIndex = CommandLine.arguments.firstIndex(of: "--focus-tab"),
   CommandLine.arguments.count > flagIndex + 1 {
    WindowManager().focusChromeTab(tabId: CommandLine.arguments[flagIndex + 1], windowId: nil)
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// Accessory: no Dock icon, behaves like a background utility (Spotlight-style).
app.setActivationPolicy(.accessory)
app.run()
