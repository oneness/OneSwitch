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

/// Menu bar presence: a status item with a "Launch at Login" toggle and Quit.
/// Also the app's only quit affordance (it has no Dock icon).
final class StatusBarController: NSObject, NSMenuDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let loginItem = NSMenuItem(title: "Launch at Login", action: nil, keyEquivalent: "")

    override init() {
        super.init()

        if let button = statusItem.button {
            button.image = Self.makeStatusImage()
            button.toolTip = "OneSwitch — press Control+Tab to switch"
        }

        let menu = NSMenu()
        menu.delegate = self

        loginItem.target = self
        loginItem.action = #selector(toggleLogin)
        menu.addItem(loginItem)

        menu.addItem(.separator())

        let quit = NSMenuItem(title: "Quit OneSwitch", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        statusItem.menu = menu
    }

    // Refresh the checkmark to reflect the real system state each time the menu opens.
    func menuWillOpen(_ menu: NSMenu) {
        loginItem.state = LoginItem.isEnabled ? .on : .off
    }

    @objc private func toggleLogin() {
        LoginItem.set(!LoginItem.isEnabled)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    /// Monochrome template image (auto-adapts to light/dark menu bar): the Control
    /// chevron stacked over the Tab arrow-to-bar glyph.
    private static func makeStatusImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 14, height: 16), flipped: false) { _ in
            NSColor.black.setStroke()
            let lw: CGFloat = 1.9

            let chevron = NSBezierPath()
            chevron.lineWidth = lw
            chevron.lineCapStyle = .round
            chevron.lineJoinStyle = .round
            chevron.move(to: NSPoint(x: 3.0, y: 9.6))
            chevron.line(to: NSPoint(x: 7.0, y: 13.4))
            chevron.line(to: NSPoint(x: 11.0, y: 9.6))
            chevron.stroke()

            let cy: CGFloat = 4.5
            let tab = NSBezierPath()
            tab.lineWidth = lw
            tab.lineCapStyle = .round
            tab.lineJoinStyle = .round
            tab.move(to: NSPoint(x: 2.2, y: cy))
            tab.line(to: NSPoint(x: 9.2, y: cy))
            tab.move(to: NSPoint(x: 7.0, y: cy + 1.9))
            tab.line(to: NSPoint(x: 9.4, y: cy))
            tab.line(to: NSPoint(x: 7.0, y: cy - 1.9))
            tab.stroke()

            let bar = NSBezierPath()
            bar.lineWidth = lw
            bar.lineCapStyle = .round
            bar.move(to: NSPoint(x: 11.4, y: cy + 2.6))
            bar.line(to: NSPoint(x: 11.4, y: cy - 2.6))
            bar.stroke()

            return true
        }
        image.isTemplate = true
        return image
    }
}
