import Cocoa

final class AppDelegate: NSObject, NSApplicationDelegate {
    let windowManager = WindowManager()
    private var hotKeyManager: HotKeyManager!
    private var switcher: SwitcherPanelController!
    private var statusBar: StatusBarController!

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusBar = StatusBarController()
        switcher = SwitcherPanelController(windowManager: windowManager)
        hotKeyManager = HotKeyManager { [weak self] in
            self?.switcher.toggle()
        }
        hotKeyManager.register()

        let trusted = windowManager.ensureAccessibilityPermission()
        FileHandle.standardError.write("OneSwitch running. Press Control+Tab to open the switcher.\n".data(using: .utf8)!)
        if !trusted {
            FileHandle.standardError.write("Accessibility permission NOT granted — per-window listing will be limited. Grant it in System Settings ▸ Privacy & Security ▸ Accessibility, then relaunch.\n".data(using: .utf8)!)
        }

        // Launch diagnostic: when launched via `open`, stderr is detached, so record state to a file.
        let windows = windowManager.getAccessibilityWindows()
        var report = "trusted: \(trusted), windows: \(windows.count)\n"
        report += windows.prefix(25).map { "  WIN \($0.ownerName): \($0.title)" }.joined(separator: "\n") + "\n"
        try? report.write(toFile: "/tmp/oneswitch-launch.log", atomically: true, encoding: .utf8)
    }
}

// Diagnostic mode: dump the item list (and any AppleScript errors) to stderr, then exit.
if CommandLine.arguments.contains("--dump") {
    let wm = WindowManager()
    let trusted = wm.ensureAccessibilityPermission()
    let tabs = wm.getBrowserTabs()
    let windows = wm.getAccessibilityWindows()
    FileHandle.standardError.write("accessibility trusted: \(trusted), chrome tabs: \(tabs.count), windows: \(windows.count)\n".data(using: .utf8)!)
    for t in tabs { FileHandle.standardError.write("  TAB \(t.ownerName): \(t.title)\n".data(using: .utf8)!) }
    for w in windows { FileHandle.standardError.write("  WIN \(w.ownerName): \(w.title)\n".data(using: .utf8)!) }
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// Accessory: no Dock icon, behaves like a background utility (Spotlight-style).
app.setActivationPolicy(.accessory)
app.run()
