import Cocoa
import Carbon.HIToolbox

/// A small capture panel: press a combo, it becomes the new hotkey. Esc (bare) or
/// clicking elsewhere cancels. Requires at least one of ⌘⌃⌥ so plain typing keys can't
/// be claimed as global hotkeys.
final class HotKeyRecorder {
    private var panel: NSPanel?
    private var keyMonitor: Any?
    private var resignObserver: Any?
    private var completion: ((HotKeyManager.HotKey?) -> Void)?

    /// Shows the panel and calls `completion` exactly once — with the captured combo, or
    /// nil if cancelled. The caller is responsible for suspending the current hotkey first.
    func begin(currentDisplay: String, completion: @escaping (HotKeyManager.HotKey?) -> Void) {
        guard panel == nil else { return }
        self.completion = completion

        let panel = KeyablePanel(
            contentRect: NSRect(x: 0, y: 0, width: 380, height: 110),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        panel.title = "OneSwitch Hotkey"
        panel.isFloatingPanel = true
        panel.level = .floating

        let label = NSTextField(labelWithString: "Press the new hotkey…")
        label.font = .systemFont(ofSize: 16, weight: .medium)
        label.alignment = .center
        let hint = NSTextField(labelWithString: "Needs ⌘, ⌃ or ⌥ — Esc cancels (current: \(currentDisplay))")
        hint.font = .systemFont(ofSize: 11)
        hint.textColor = .secondaryLabelColor
        hint.alignment = .center
        let stack = NSStackView(views: [label, hint])
        stack.orientation = .vertical
        stack.spacing = 8
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 16, bottom: 20, right: 16)
        panel.contentView = stack

        panel.center()
        self.panel = panel

        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            let flags = event.modifierFlags.intersection([.command, .control, .option, .shift])
            if Int(event.keyCode) == kVK_Escape && flags.isEmpty {
                self.finish(nil)
                return nil
            }
            guard !flags.intersection([.command, .control, .option]).isEmpty else { return nil }
            self.finish(HotKeyManager.HotKey(keyCode: UInt32(event.keyCode),
                                             carbonModifiers: Self.carbonModifiers(from: flags),
                                             display: Self.display(keyCode: event.keyCode, flags: flags, event: event)))
            return nil
        }
        resignObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.didResignKeyNotification, object: panel, queue: .main
        ) { [weak self] _ in
            self?.finish(nil)
        }

        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    private func finish(_ hotKey: HotKeyManager.HotKey?) {
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        keyMonitor = nil
        if let resignObserver { NotificationCenter.default.removeObserver(resignObserver) }
        resignObserver = nil
        panel?.orderOut(nil)
        panel = nil
        completion?(hotKey)
        completion = nil
    }

    private static func carbonModifiers(from flags: NSEvent.ModifierFlags) -> UInt32 {
        var carbon: UInt32 = 0
        if flags.contains(.command) { carbon |= UInt32(cmdKey) }
        if flags.contains(.control) { carbon |= UInt32(controlKey) }
        if flags.contains(.option) { carbon |= UInt32(optionKey) }
        if flags.contains(.shift) { carbon |= UInt32(shiftKey) }
        return carbon
    }

    private static func display(keyCode: UInt16, flags: NSEvent.ModifierFlags, event: NSEvent) -> String {
        var text = ""
        if flags.contains(.control) { text += "⌃" }
        if flags.contains(.option) { text += "⌥" }
        if flags.contains(.shift) { text += "⇧" }
        if flags.contains(.command) { text += "⌘" }
        return text + keyName(keyCode: keyCode, event: event)
    }

    private static func keyName(keyCode: UInt16, event: NSEvent) -> String {
        switch Int(keyCode) {
        case kVK_Tab: return "⇥"
        case kVK_Space: return "Space"
        case kVK_Return: return "↩"
        case kVK_Delete: return "⌫"
        case kVK_Escape: return "⎋"
        case kVK_LeftArrow: return "←"
        case kVK_RightArrow: return "→"
        case kVK_UpArrow: return "↑"
        case kVK_DownArrow: return "↓"
        case kVK_F1: return "F1"; case kVK_F2: return "F2"; case kVK_F3: return "F3"
        case kVK_F4: return "F4"; case kVK_F5: return "F5"; case kVK_F6: return "F6"
        case kVK_F7: return "F7"; case kVK_F8: return "F8"; case kVK_F9: return "F9"
        case kVK_F10: return "F10"; case kVK_F11: return "F11"; case kVK_F12: return "F12"
        default:
            return event.charactersIgnoringModifiers?.uppercased() ?? "key\(keyCode)"
        }
    }
}
