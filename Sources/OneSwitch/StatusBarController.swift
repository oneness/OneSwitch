import Cocoa
import ServiceManagement

/// Thin wrapper over the macOS 13+ login-item API.
enum LoginItem {
    static var isEnabled: Bool {
        SMAppService.mainApp.status == .enabled
    }

    static func set(_ enabled: Bool) {
        do {
            if enabled {
                if SMAppService.mainApp.status != .enabled {
                    try SMAppService.mainApp.register()
                }
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            AppLog.log("Login item toggle failed: \(error)")
        }
    }
}

/// Menu bar presence: a status item with hotkey configuration, a "Launch at Login"
/// toggle, and Quit. Also the app's only quit affordance (it has no Dock icon).
final class StatusBarController: NSObject, NSMenuDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let loginItem = NSMenuItem(title: "Launch at Login", action: nil, keyEquivalent: "")
    private let hotkeyItem = NSMenuItem(title: "Change Hotkey…", action: nil, keyEquivalent: "")
    private let hotKeyManager: HotKeyManager
    private let recorder = HotKeyRecorder()

    init(hotKeyManager: HotKeyManager) {
        self.hotKeyManager = hotKeyManager
        super.init()

        if let button = statusItem.button {
            button.image = Self.makeStatusImage()
            button.toolTip = "OneSwitch — press \(hotKeyManager.hotKey.display) to switch"
        }

        let menu = NSMenu()
        menu.delegate = self

        hotkeyItem.target = self
        hotkeyItem.action = #selector(changeHotkey)
        menu.addItem(hotkeyItem)

        loginItem.target = self
        loginItem.action = #selector(toggleLogin)
        menu.addItem(loginItem)

        menu.addItem(.separator())

        let quit = NSMenuItem(title: "Quit OneSwitch", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        statusItem.menu = menu
    }

    // Refresh the checkmark and hotkey label to reflect real state each time the menu opens.
    func menuWillOpen(_ menu: NSMenu) {
        loginItem.state = LoginItem.isEnabled ? .on : .off
        hotkeyItem.title = "Change Hotkey (\(hotKeyManager.hotKey.display))…"
    }

    @objc private func toggleLogin() {
        LoginItem.set(!LoginItem.isEnabled)
    }

    /// Suspend the current hotkey while recording (so the same combo can be re-recorded),
    /// then apply the captured combo — or restore the old one on cancel.
    @objc private func changeHotkey() {
        hotKeyManager.unregister()
        recorder.begin(currentDisplay: hotKeyManager.hotKey.display) { [weak self] captured in
            guard let self else { return }
            if let captured {
                self.hotKeyManager.apply(captured)
            } else {
                self.hotKeyManager.register()
            }
            self.statusItem.button?.toolTip = "OneSwitch — press \(self.hotKeyManager.hotKey.display) to switch"
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    /// Menu-bar badge: a near-black rounded-square tile with a white toggle switch in the
    /// ON position inset inside it. Sized and styled to match the VoiceToText menu-bar
    /// icon exactly (20pt tile, same insets / corner radius / background), so it sits at
    /// the same visual size as other apps. Fixed colors (not a template) so the dark
    /// background is preserved in both light and dark menu bars.
    private static func makeStatusImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 20, height: 20), flipped: false) { _ in
            // Background tile (matches VoiceToText's insets / colour / corner radius).
            let b = NSRect(x: 0, y: 0, width: 20, height: 20)
                .insetBy(dx: 0.4, dy: 0.4).insetBy(dx: 0.45, dy: 0.45)
            let bg = NSBezierPath(roundedRect: b, xRadius: max(3.0, b.width * 0.24), yRadius: max(3.0, b.width * 0.24))
            NSColor(calibratedWhite: 0.06, alpha: 1.0).setFill()
            bg.fill()
            NSColor(calibratedWhite: 1.0, alpha: 0.10).setStroke()
            bg.lineWidth = 0.7
            bg.stroke()

            // White vertical toggle (knob pushed up = ON), centered with a generous margin.
            NSColor.white.setStroke()
            NSColor.white.setFill()
            let tw = b.width * 0.30, th = b.height * 0.56
            let track = NSRect(x: b.midX - tw/2, y: b.midY - th/2, width: tw, height: th)
            let pill = NSBezierPath(roundedRect: track, xRadius: track.width/2, yRadius: track.width/2)
            pill.lineWidth = max(0.8, tw * 0.16)
            pill.stroke()

            let inset = tw * 0.18
            let d = tw - inset*2
            let knob = NSRect(x: track.minX + inset, y: track.maxY - inset - d, width: d, height: d)
            NSBezierPath(ovalIn: knob).fill()

            return true
        }
        return image
    }
}
