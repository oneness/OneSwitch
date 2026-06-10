import AppKit
import ApplicationServices

/// Diagnostic: prints an app's accessibility tree (chrome UI only — web content areas are
/// pruned, they are enormous). Used to discover how non-scriptable browsers expose tabs.
enum AXDump {
    static func dump(appNamed name: String) {
        guard let app = NSWorkspace.shared.runningApplications
            .first(where: { $0.localizedName?.lowercased() == name.lowercased() }) else {
            FileHandle.standardError.write("no running app named \(name)\n".data(using: .utf8)!)
            return
        }
        var emitted = 0
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        walk(appElement, depth: 0, emitted: &emitted)
    }

    private static func attr(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        AXUIElementCopyAttributeValue(element, name as CFString, &value)
        return value
    }

    private static func walk(_ element: AXUIElement, depth: Int, emitted: inout Int) {
        guard depth < 12, emitted < 600 else { return }
        let role = (attr(element, kAXRoleAttribute) as? String) ?? "?"
        let subrole = (attr(element, kAXSubroleAttribute) as? String).map { " subrole=\($0)" } ?? ""
        let title = (attr(element, kAXTitleAttribute) as? String).map { " title=\"\($0)\"" } ?? ""
        let desc = (attr(element, kAXDescriptionAttribute) as? String).map { " desc=\"\($0)\"" } ?? ""
        let selected = (attr(element, "AXSelected") as? Bool).map { " selected=\($0)" } ?? ""
        var actionsArray: CFArray?
        AXUIElementCopyActionNames(element, &actionsArray)
        let actions = (actionsArray as? [String]).flatMap { $0.isEmpty ? nil : " actions=\($0.joined(separator: ","))" } ?? ""

        let pad = String(repeating: "  ", count: depth)
        FileHandle.standardError.write("\(pad)\(role)\(subrole)\(title)\(desc)\(selected)\(actions)\n".data(using: .utf8)!)
        emitted += 1

        guard role != "AXWebArea" else { return }   // skip page content — huge
        guard let children = attr(element, kAXChildrenAttribute) as? [AXUIElement] else { return }
        for child in children.prefix(80) {
            walk(child, depth: depth + 1, emitted: &emitted)
        }
    }
}
