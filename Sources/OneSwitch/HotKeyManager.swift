import Cocoa
import Carbon.HIToolbox

/// Registers a single global hotkey (default Control+Tab) using the Carbon hotkey API.
/// This works without Accessibility permission. The combo is user-configurable via the
/// menu bar (persisted in UserDefaults); modifier-only combos are not supported by the
/// Carbon API — every hotkey is a key plus at least one of ⌘⌃⌥.
final class HotKeyManager {
    struct HotKey {
        var keyCode: UInt32
        var carbonModifiers: UInt32
        var display: String

        static let defaultHotKey = HotKey(keyCode: UInt32(kVK_Tab),
                                          carbonModifiers: UInt32(controlKey),
                                          display: "⌃⇥")
    }

    private(set) var hotKey: HotKey
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private let onTrigger: () -> Void

    init(onTrigger: @escaping () -> Void) {
        self.onTrigger = onTrigger
        let defaults = UserDefaults.standard
        if defaults.object(forKey: "hotKeyCode") != nil {
            hotKey = HotKey(keyCode: UInt32(defaults.integer(forKey: "hotKeyCode")),
                            carbonModifiers: UInt32(defaults.integer(forKey: "hotKeyModifiers")),
                            display: defaults.string(forKey: "hotKeyDisplay") ?? "?")
        } else {
            hotKey = .defaultHotKey
        }
    }

    func register() {
        installEventHandlerIfNeeded()
        guard hotKeyRef == nil else { return }

        // 'OSWT' signature, id 1
        let hotKeyID = EventHotKeyID(signature: OSType(0x4F535754), id: 1)
        let status = RegisterEventHotKey(hotKey.keyCode,
                                         hotKey.carbonModifiers,
                                         hotKeyID,
                                         GetApplicationEventTarget(),
                                         0,
                                         &hotKeyRef)
        if status != noErr {
            AppLog.log("Failed to register \(hotKey.display) hotkey (status \(status))")
        }
    }

    /// Temporarily release the hotkey (used while the recorder panel captures a new one,
    /// so the current combo can be re-recorded instead of triggering the switcher).
    func unregister() {
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        hotKeyRef = nil
    }

    /// Switch to a new combo: persist it, then re-register.
    func apply(_ newHotKey: HotKey) {
        hotKey = newHotKey
        let defaults = UserDefaults.standard
        defaults.set(Int(newHotKey.keyCode), forKey: "hotKeyCode")
        defaults.set(Int(newHotKey.carbonModifiers), forKey: "hotKeyModifiers")
        defaults.set(newHotKey.display, forKey: "hotKeyDisplay")
        unregister()
        register()
        AppLog.log("hotkey changed to \(newHotKey.display)")
    }

    private func installEventHandlerIfNeeded() {
        guard eventHandler == nil else { return }
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                      eventKind: OSType(kEventHotKeyPressed))
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { (_, _, userData) -> OSStatus in
            guard let userData = userData else { return noErr }
            let manager = Unmanaged<HotKeyManager>.fromOpaque(userData).takeUnretainedValue()
            manager.onTrigger()
            return noErr
        }, 1, &eventType, selfPtr, &eventHandler)
    }

    deinit {
        unregister()
        if let eventHandler = eventHandler { RemoveEventHandler(eventHandler) }
    }
}
