import Cocoa
import ApplicationServices

final class AppDelegate: NSObject, NSApplicationDelegate {
    let windowManager = WindowManager()
    private let windowHistory = WindowHistory()
    private var hotKeyManager: HotKeyManager!
    private var switcher: SwitcherPanelController!
    private var statusBar: StatusBarController!

    func applicationDidFinishLaunching(_ notification: Notification) {
        switcher = SwitcherPanelController(windowManager: windowManager, history: windowHistory)
        hotKeyManager = HotKeyManager { [weak self] in
            self?.switcher.handleHotkey()
        }
        hotKeyManager.register()
        statusBar = StatusBarController(hotKeyManager: hotKeyManager)

        let trusted = windowManager.ensureAccessibilityPermission()

        // Firefox builds its AX tree only once told an assistive client exists — nudge it
        // now if it's already running, and again whenever it launches (see
        // enableFirefoxAccessibility). Without this, a Firefox started after OneSwitch
        // lists only a bare window (no tabs) for a long while.
        windowManager.enableFirefoxAccessibility()
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            if app?.localizedName == "Firefox" {
                self?.windowManager.enableFirefoxAccessibility()
            }
        }
        // Launch diagnostic: when launched via `open`, stderr is detached, so AppLog also
        // records this to ~/Library/Logs/OneSwitch.log.
        let windows = windowManager.getAccessibilityWindows()
        AppLog.log("launched: accessibility trusted: \(trusted), windows: \(windows.count). Press \(hotKeyManager.hotKey.display) to open the switcher.")
        if !trusted {
            AppLog.log("Accessibility permission NOT granted — per-window listing will be limited. Grant it in System Settings ▸ Privacy & Security ▸ Accessibility, then relaunch.")
        }
    }
}

// Diagnostic mode: dump the item list exactly as the switcher builds it (allItems()),
// plus the installed-app catalog, then exit. Errors land on stderr too.
if CommandLine.arguments.contains("--dump") {
    let wm = WindowManager()
    let trusted = wm.ensureAccessibilityPermission()
    let items = wm.allItems()
    let apps = AppCatalog().apps()
    let tabs = items.filter { $0.isTab }
    let windows = items.filter { !$0.isTab }
    FileHandle.standardError.write("accessibility trusted: \(trusted), tabs: \(tabs.count), windows: \(windows.count), installed apps: \(apps.count)\n".data(using: .utf8)!)
    for t in tabs {
        let ref = t.chromeWindowId.map { "win \($0) tab \(t.chromeTabId ?? "?")" } ?? t.id
        FileHandle.standardError.write("  TAB\(t.isActiveTab ? "*" : " ") \(t.ownerName) [\(ref)]: \(t.title)\n".data(using: .utf8)!)
    }
    for w in windows { FileHandle.standardError.write("  WIN \(w.ownerName): \(w.title)\n".data(using: .utf8)!) }
    for a in apps.prefix(10) { FileHandle.standardError.write("  APP \(a.name): \(a.url.path)\n".data(using: .utf8)!) }
    exit(0)
}

// Diagnostic mode: print an app's accessibility tree (web content pruned), then exit.
if let flagIndex = CommandLine.arguments.firstIndex(of: "--ax-dump"),
   CommandLine.arguments.count > flagIndex + 1 {
    WindowManager().ensureAccessibilityPermission()
    AXDump.dump(appNamed: CommandLine.arguments[flagIndex + 1])
    exit(0)
}

// Diagnostic mode: press a Firefox tab button by id (e.g. fftab-0-1, as printed by
// --dump) without raising the window, then exit.
if let flagIndex = CommandLine.arguments.firstIndex(of: "--focus-fftab"),
   CommandLine.arguments.count > flagIndex + 1 {
    let wm = WindowManager()
    wm.ensureAccessibilityPermission()
    let id = CommandLine.arguments[flagIndex + 1]
    if let item = wm.getFirefoxTabs().first(where: { $0.id == id }), let tab = item.axTabElement {
        let result = AXUIElementPerformAction(tab, kAXPressAction as CFString)
        FileHandle.standardError.write("press \(id) (\(item.title)): \(result == .success ? "ok" : "AXError \(result.rawValue)")\n".data(using: .utf8)!)
    } else {
        FileHandle.standardError.write("no Firefox tab with id \(id)\n".data(using: .utf8)!)
    }
    exit(0)
}

// Diagnostic mode: run a shell command through CommandRunner (command mode's engine),
// print the result, then exit. Note: replaces the clipboard, like command mode does.
if let flagIndex = CommandLine.arguments.firstIndex(of: "--run-cmd"),
   CommandLine.arguments.count > flagIndex + 1 {
    let runner = CommandRunner()
    runner.run(CommandLine.arguments[flagIndex + 1])
    while runner.isRunning { RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
    if case .finished(_, let output, let exitCode) = runner.state {
        let clipboard = NSPasteboard.general.string(forType: .string) ?? "(nil)"
        FileHandle.standardError.write("exit \(exitCode)\noutput: \(output)\nclipboard: \(clipboard)\n".data(using: .utf8)!)
    }
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
