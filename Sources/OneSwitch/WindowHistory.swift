import AppKit
import ApplicationServices

// Private AX SPI: maps an AXUIElement window to its stable CGWindowID. Widely used by window
// managers. We need a stable identity because AXUIElements for the same window obtained via
// different attributes (kAXFocusedWindow vs kAXWindows) are not reliably CFEqual.
@_silgen_name("_AXUIElementGetWindow")
private func _AXUIElementGetWindow(_ element: AXUIElement, _ identifier: UnsafeMutablePointer<CGWindowID>) -> AXError

/// Tracks most-recently-used windows (front first) by CGWindowID so Ctrl+Tab can toggle to the
/// previous one — and back.
///
/// Sources of updates:
///  - NSWorkspace app-activation notifications (records the newly-active app's focused window)
///  - explicit record() when OneSwitch raises a window
///  - captureFront() when the switcher opens, to anchor the current front
///
/// Limitation: switching between two windows of the *same* app without changing apps fires no
/// activation notification, so intra-app window order can lag until the switcher is next opened.
final class WindowHistory {
    private(set) var order: [CGWindowID] = []   // most-recent first

    init() {
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(appActivated(_:)),
            name: NSWorkspace.didActivateApplicationNotification, object: nil)
    }

    @objc private func appActivated(_ note: Notification) {
        let key = NSWorkspace.applicationUserInfoKey
        guard let app = note.userInfo?[key] as? NSRunningApplication else { return }
        captureFocusedWindow(of: app)
    }

    /// Record the currently focused window of the frontmost app (call when the switcher opens).
    func captureFront() {
        if let app = NSWorkspace.shared.frontmostApplication {
            captureFocusedWindow(of: app)
        }
    }

    private func captureFocusedWindow(of app: NSRunningApplication) {
        guard app.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return }
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &focused) == .success,
              let value = focused, CFGetTypeID(value) == AXUIElementGetTypeID() else { return }
        record(value as! AXUIElement)
    }

    func record(_ element: AXUIElement) {
        guard let id = windowID(of: element) else { return }
        order.removeAll { $0 == id }
        order.insert(id, at: 0)
        if order.count > 50 { order.removeLast(order.count - 50) }
    }

    /// Recency rank of a window (0 = most recent); unknown windows sort last.
    func rank(of element: AXUIElement?) -> Int {
        guard let element, let id = windowID(of: element) else { return Int.max }
        return order.firstIndex(of: id) ?? Int.max
    }

    private func windowID(of element: AXUIElement) -> CGWindowID? {
        var id = CGWindowID(0)
        return _AXUIElementGetWindow(element, &id) == .success && id != 0 ? id : nil
    }
}
