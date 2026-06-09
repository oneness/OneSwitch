import Cocoa
import Carbon.HIToolbox

/// Registers a single global hotkey (Control+Tab) using the Carbon hotkey API.
/// This works without Accessibility permission.
final class HotKeyManager {
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private let onTrigger: () -> Void

    init(onTrigger: @escaping () -> Void) {
        self.onTrigger = onTrigger
    }

    func register() {
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                      eventKind: OSType(kEventHotKeyPressed))

        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { (_, _, userData) -> OSStatus in
            guard let userData = userData else { return noErr }
            let manager = Unmanaged<HotKeyManager>.fromOpaque(userData).takeUnretainedValue()
            manager.onTrigger()
            return noErr
        }, 1, &eventType, selfPtr, &eventHandler)

        // 'OSWT' signature, id 1
        let hotKeyID = EventHotKeyID(signature: OSType(0x4F535754), id: 1)
        let status = RegisterEventHotKey(UInt32(kVK_Tab),
                                         UInt32(controlKey),
                                         hotKeyID,
                                         GetApplicationEventTarget(),
                                         0,
                                         &hotKeyRef)
        if status != noErr {
            FileHandle.standardError.write("Failed to register Control+Tab hotkey (status \(status))\n".data(using: .utf8)!)
        }
    }

    deinit {
        if let hotKeyRef = hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        if let eventHandler = eventHandler { RemoveEventHandler(eventHandler) }
    }
}
