import Cocoa
import SwiftUI

/// Borderless panel that can still receive keyboard focus.
final class KeyablePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

/// Owns the popup panel and bridges keyboard events to the model.
final class SwitcherPanelController {
    private let windowManager: WindowManager
    private let history: WindowHistory
    private let model: SwitcherModel
    private var panel: NSPanel?
    private var keyMonitor: Any?

    init(windowManager: WindowManager, history: WindowHistory) {
        self.windowManager = windowManager
        self.history = history
        self.model = SwitcherModel()
        model.onActivate = { [weak self] item in self?.activate(item) }
        model.onDismiss = { [weak self] in self?.hide() }
    }

    /// Control+Tab toggles the switcher open/closed; plain Tab cycles the selection.
    func handleHotkey() {
        if panel?.isVisible == true { hide() } else { show() }
    }

    private func show() {
        history.captureFront()                              // keep recency current
        let items = orderedByRecency(windowManager.allItems())
        model.setItems(items)                               // selection starts at the top

        let panel = self.panel ?? makePanel()
        self.panel = panel

        if let screen = NSScreen.main {
            let size = panel.frame.size
            let origin = NSPoint(x: screen.frame.midX - size.width / 2,
                                 y: screen.frame.midY - size.height / 2)
            panel.setFrameOrigin(origin)
        }

        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        installKeyMonitor()
    }

    private func hide() {
        removeKeyMonitor()
        panel?.orderOut(nil)
    }

    private func activate(_ item: WindowItem) {
        if let window = item.axWindow { history.record(window) }
        hide()
        windowManager.activate(item: item)
    }

    /// Order windows by MRU (most-recent first); items without a tracked window (browser tabs,
    /// app fallbacks) keep their relative order at the end.
    private func orderedByRecency(_ items: [WindowItem]) -> [WindowItem] {
        items.enumerated()
            .sorted { a, b in
                let ra = history.rank(of: a.element.axWindow)
                let rb = history.rank(of: b.element.axWindow)
                return ra != rb ? ra < rb : a.offset < b.offset
            }
            .map { $0.element }
    }

    private func makePanel() -> NSPanel {
        let panel = KeyablePanel(
            contentRect: NSRect(x: 0, y: 0, width: 600, height: 420),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.contentView = NSHostingView(rootView: SwitcherView(model: model))
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hasShadow = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        return panel
    }

    private func installKeyMonitor() {
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self = self else { return event }
            let ctrl = event.modifierFlags.contains(.control)
            switch Int(event.keyCode) {
            case 48:                                             // Tab cycles (Shift+Tab reverses)
                self.model.moveSelection(event.modifierFlags.contains(.shift) ? -1 : 1); return nil
            case 125: self.model.moveSelection(1); return nil    // down arrow
            case 126: self.model.moveSelection(-1); return nil   // up arrow
            case 45 where ctrl: self.model.moveSelection(1); return nil   // Ctrl+N -> next
            case 35 where ctrl: self.model.moveSelection(-1); return nil  // Ctrl+P -> previous
            case 36, 76: self.model.activateSelection(); return nil       // return / keypad enter
            case 53: self.model.dismiss(); return nil            // esc
            default: return event                                // everything else types into search
            }
        }
    }

    private func removeKeyMonitor() {
        if let m = keyMonitor { NSEvent.removeMonitor(m) }
        keyMonitor = nil
    }
}
