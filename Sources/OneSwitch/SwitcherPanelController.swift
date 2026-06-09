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
    private let model: SwitcherModel
    private var panel: NSPanel?
    private var keyMonitor: Any?

    init(windowManager: WindowManager) {
        self.windowManager = windowManager
        self.model = SwitcherModel()
        model.onActivate = { [weak self] item in self?.activate(item) }
        model.onDismiss = { [weak self] in self?.hide() }
    }

    func toggle() {
        if panel?.isVisible == true {
            hide()
        } else {
            show()
        }
    }

    private func show() {
        model.setItems(windowManager.allItems())

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
        hide()
        windowManager.activate(item: item)
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
            switch Int(event.keyCode) {
            case 125: self.model.moveSelection(1); return nil   // down arrow
            case 126: self.model.moveSelection(-1); return nil  // up arrow
            case 36, 76: self.model.activateSelection(); return nil // return / keypad enter
            case 53: self.model.dismiss(); return nil           // esc
            default: return event
            }
        }
    }

    private func removeKeyMonitor() {
        if let keyMonitor = keyMonitor {
            NSEvent.removeMonitor(keyMonitor)
            self.keyMonitor = nil
        }
    }
}
