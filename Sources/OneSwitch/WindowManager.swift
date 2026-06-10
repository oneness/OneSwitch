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
    /// For browser tabs: Chrome's stable per-tab id, used to focus the tab on activation.
    var chromeTabId: String? = nil
    /// For browser tabs: the id of the Chrome window the tab was listed in (it may move).
    var chromeWindowId: String? = nil
    /// Reference to a specific window (via the Accessibility API) so we can raise exactly it.
    var axWindow: AXUIElement? = nil
    /// The owning app's icon, shown in the switcher row.
    var icon: NSImage? = nil
    /// For browser tabs: the page URL, used to resolve the tab's favicon (loaded lazily).
    var pageURL: URL? = nil
    /// For browser tabs: whether this was the window's active tab when listed.
    var isActiveTab: Bool = false
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
                                        isTab: false, icon: app.icon))
                continue
            }

            for (idx, window) in windows.enumerated() {
                var titleValue: CFTypeRef?
                AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleValue)
                let rawTitle = (titleValue as? String) ?? ""
                let title = rawTitle.isEmpty ? name : rawTitle
                items.append(WindowItem(id: "win-\(app.processIdentifier)-\(idx)", title: title,
                                        ownerName: name, pid: app.processIdentifier,
                                        isTab: false, axWindow: window, icon: app.icon))
            }
        }
        return items
    }

    /// The user's real Chrome instance. Browser tooling spawns extra Chrome processes
    /// (`--headless --user-data-dir=…`) that register under the same bundle id; those are
    /// background-only (`activationPolicy != .regular`), so filter them out. If several
    /// real instances exist, prefer the longest-running one.
    private func realChrome() -> NSRunningApplication? {
        NSWorkspace.shared.runningApplications
            .filter { $0.bundleIdentifier == "com.google.Chrome" && $0.activationPolicy == .regular }
            .min { ($0.launchDate ?? .distantPast) < ($1.launchDate ?? .distantPast) }
    }

    /// Deep queries Chrome tabs natively via pid-addressed Apple Events (Zero Extensions).
    /// See ChromeScripting for why this does not use AppleScript: with multiple Chrome
    /// processes running, bundle-id addressing can silently query a headless automation
    /// instance instead of the user's browser.
    /// Firefox is intentionally omitted: it offers no per-tab scripting and names only its
    /// frontmost window, so its windows surface via getAccessibilityWindows() instead.
    func getBrowserTabs() -> [WindowItem] {
        guard let chrome = realChrome() else { return [] }
        let scripting = ChromeScripting(pid: chrome.processIdentifier)

        var items = [WindowItem]()
        do {
            for windowId in try scripting.windowIds() {
                let ids = try scripting.tabProperty("ID  ", windowId: windowId)
                let titles = try scripting.tabProperty("pnam", windowId: windowId)
                let urls = try scripting.tabProperty("URL ", windowId: windowId)
                let activeIndex = (try? scripting.activeTabIndex(windowId: windowId)) ?? nil
                for i in 0..<min(ids.count, titles.count, urls.count) {
                    let title = titles[i].trimmingCharacters(in: .whitespaces)
                    guard !title.isEmpty else { continue }
                    // Favicons only make sense for web pages (not chrome:// and friends).
                    var pageURL = URL(string: urls[i])
                    if let scheme = pageURL?.scheme?.lowercased(), !["http", "https"].contains(scheme) {
                        pageURL = nil
                    }
                    items.append(WindowItem(id: "tab-\(ids[i])", title: title, ownerName: "Chrome",
                                            pid: chrome.processIdentifier, isTab: true,
                                            chromeTabId: ids[i], chromeWindowId: windowId,
                                            icon: chrome.icon, pageURL: pageURL,
                                            isActiveTab: activeIndex == i + 1))
                }
            }
        } catch {
            AppLog.log("list Chrome tabs (pid \(chrome.processIdentifier)): \(error)")
        }
        return items
    }

    /// Action handler to switch, focus, or execute actions on selected items.
    func activate(item: WindowItem) {
        if item.isTab, let tabId = item.chromeTabId {
            focusChromeTab(tabId: tabId, windowId: item.chromeWindowId)
            // Bring Chrome itself forward; OneSwitch is frontmost here, so it may hand
            // focus over — same call the window path uses.
            NSRunningApplication(processIdentifier: item.pid)?.activate(options: [.activateIgnoringOtherApps])
            return
        }

        // Raise the specific window if we have an AX reference, then bring its app forward.
        if let window = item.axWindow {
            AXUIElementPerformAction(window, kAXRaiseAction as CFString)
            AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
        }
        NSRunningApplication(processIdentifier: item.pid)?.activate(options: [.activateIgnoringOtherApps])
    }

    /// Focuses a Chrome tab by its stable id. Checks the window the tab was listed in first,
    /// then falls back to scanning every window (the tab may have been dragged elsewhere).
    /// Sets the active tab *index* — Chrome does not reliably support `index of <tab>`
    /// directly (errors with -10006).
    func focusChromeTab(tabId: String, windowId: String?) {
        guard let chrome = realChrome() else {
            AppLog.log("activate Chrome tab \(tabId): Chrome not running")
            return
        }
        let scripting = ChromeScripting(pid: chrome.processIdentifier)
        do {
            var candidates = windowId.map { [$0] } ?? []
            candidates += try scripting.windowIds().filter { $0 != windowId }
            for window in candidates {
                guard let ids = try? scripting.tabProperty("ID  ", windowId: window),
                      let index = ids.firstIndex(of: tabId) else { continue }
                try scripting.setActiveTabIndex(index + 1, windowId: window)
                try scripting.raiseWindow(window)
                return
            }
            AppLog.log("activate Chrome tab \(tabId): tab not found in any window")
        } catch {
            AppLog.log("activate Chrome tab \(tabId): \(error)")
        }
    }
}
