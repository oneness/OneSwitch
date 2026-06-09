import Foundation
import Cocoa
import CoreGraphics
import ApplicationServices

/// Model representing either an accessibility window, a running app, or an internal browser tab.
struct WindowItem {
    let id: String
    let title: String
    let ownerName: String
    let pid: pid_t
    let isTab: Bool
    let tabIndex: Int?
    /// Reference to a specific window (via the Accessibility API) so we can raise exactly it.
    var axWindow: AXUIElement? = nil
}

class WindowManager {

    /// Combined list shown in the switcher: Chrome tabs (most granular) on top,
    /// then every app's individual windows via the Accessibility API.
    func allItems() -> [WindowItem] {
        var items = getBrowserTabs()
        items.append(contentsOf: getAccessibilityWindows())
        return items
    }

    /// Prompts for Accessibility permission if not yet granted. Returns current trust status.
    @discardableResult
    func ensureAccessibilityPermission() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    /// Per-window list across all regular apps via the Accessibility API. Window titles work
    /// without Screen Recording. Chrome is excluded here because its tabs are listed separately.
    /// Apps that expose no windows fall back to a single app-level entry so they stay switchable.
    func getAccessibilityWindows() -> [WindowItem] {
        var items = [WindowItem]()
        let myPid = ProcessInfo.processInfo.processIdentifier

        for app in NSWorkspace.shared.runningApplications {
            guard app.activationPolicy == .regular,
                  let name = app.localizedName,
                  app.processIdentifier != myPid,
                  name != "Google Chrome" else { continue }

            let appElement = AXUIElementCreateApplication(app.processIdentifier)
            var value: CFTypeRef?
            let result = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &value)

            guard result == .success, let windows = value as? [AXUIElement], !windows.isEmpty else {
                // Fallback: no AX windows available — keep the app reachable as one entry.
                items.append(WindowItem(id: "app-\(app.processIdentifier)", title: name,
                                        ownerName: name, pid: app.processIdentifier,
                                        isTab: false, tabIndex: nil))
                continue
            }

            for (idx, window) in windows.enumerated() {
                var titleValue: CFTypeRef?
                AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleValue)
                let rawTitle = (titleValue as? String) ?? ""
                let title = rawTitle.isEmpty ? name : rawTitle
                items.append(WindowItem(id: "win-\(app.processIdentifier)-\(idx)", title: title,
                                        ownerName: name, pid: app.processIdentifier,
                                        isTab: false, tabIndex: nil, axWindow: window))
            }
        }
        return items
    }

    /// Deep queries Chrome tabs natively via AppleScript (Zero Extensions).
    /// Firefox is intentionally omitted: it offers no per-tab scripting and names only its
    /// frontmost window, so its windows surface via getAccessibilityWindows() instead.
    func getBrowserTabs() -> [WindowItem] {
        var items = [WindowItem]()

        // Uses `linefeed` as the row separator (a raw newline inside an AppleScript
        // string literal is a syntax error).
        let appleScriptSource = """
        set output to ""

        if application "Google Chrome" is running then
            tell application "Google Chrome"
                repeat with w in windows
                    repeat with t in tabs of w
                        set output to output & "Chrome||" & (id of t as string) & "||" & (title of t) & linefeed
                    end repeat
                end repeat
            end tell
        end if

        return output
        """

        if let script = NSAppleScript(source: appleScriptSource) {
            var error: NSDictionary?
            let output = script.executeAndReturnError(&error)
            if let error = error {
                FileHandle.standardError.write("getBrowserTabs AppleScript error: \(error)\n".data(using: .utf8)!)
            }
            if error == nil, let text = output.stringValue {
                let lines = text.components(separatedBy: "\n")
                for line in lines where !line.isEmpty {
                    let parts = line.components(separatedBy: "||")
                    if parts.count >= 3 {
                        let browser = parts[0]
                        let tabId = parts[1]
                        let title = parts[2...].joined(separator: "||").trimmingCharacters(in: .whitespaces)
                        guard !title.isEmpty else { continue }
                        items.append(WindowItem(id: tabId, title: title, ownerName: browser, pid: 0, isTab: true, tabIndex: Int(tabId)))
                    }
                }
            }
        }
        return items
    }

    /// Action handler to switch, focus, or execute actions on selected items.
    func activate(item: WindowItem) {
        if item.isTab && item.ownerName == "Chrome" {
            // Use an explicit integer counter to set the active tab index. Chrome does not
            // reliably support `index of <tab>` directly (errors with -10006).
            let focusScript = """
            tell application "Google Chrome"
                repeat with w in windows
                    set tabList to tabs of w
                    repeat with i from 1 to (count of tabList)
                        if (id of (item i of tabList) as string) is "\(item.id)" then
                            set active tab index of w to i
                            set index of w to 1
                            activate
                            return
                        end if
                    end repeat
                end repeat
            end tell
            """
            if let script = NSAppleScript(source: focusScript) {
                var error: NSDictionary?
                script.executeAndReturnError(&error)
                if let error = error {
                    FileHandle.standardError.write("activate tab AppleScript error: \(error)\n".data(using: .utf8)!)
                }
            }
            return
        }

        // Raise the specific window if we have an AX reference, then bring its app forward.
        if let window = item.axWindow {
            AXUIElementPerformAction(window, kAXRaiseAction as CFString)
            AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
        }
        NSRunningApplication(processIdentifier: item.pid)?.activate(options: [.activateIgnoringOtherApps])
    }
}
