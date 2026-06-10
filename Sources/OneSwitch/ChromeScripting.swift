import Foundation

/// Sends pid-addressed Apple Events to one specific Chrome instance.
///
/// AppleScript (`tell application "Google Chrome"`) addresses by bundle id, and when more
/// than one Chrome process is running — e.g. a headless automation instance spawned with
/// `--headless --user-data-dir=…` by browser tooling — macOS routes the events to an
/// arbitrary instance, silently querying the wrong browser. Addressing by pid removes the
/// ambiguity. Codes come from Chrome's scripting.sdef: window `cwin` (id `ID  `, index
/// `pidx`, active tab index `acTI`), tab `CrTb` (id `ID  `, title `pnam`, URL `URL `).
/// Chrome declares both ids as *text*.
struct ChromeScripting {
    let pid: pid_t

    struct AEFailure: Error, CustomStringConvertible {
        let context: String
        let detail: String
        var description: String { "\(context): \(detail)" }
    }

    private var target: NSAppleEventDescriptor {
        NSAppleEventDescriptor(processIdentifier: pid)
    }

    private static func fcc(_ s: String) -> OSType {
        s.utf8.reduce(0) { ($0 << 8) | OSType($1) }
    }

    // MARK: Descriptor building

    /// `{ want: class, form: …, seld: …, from: container }` coerced to an object specifier.
    private func specifier(want: String, form: String, seld: NSAppleEventDescriptor,
                           from container: NSAppleEventDescriptor?) -> NSAppleEventDescriptor {
        let record = NSAppleEventDescriptor.record()
        record.setDescriptor(NSAppleEventDescriptor(typeCode: Self.fcc(want)), forKeyword: Self.fcc("want"))
        record.setDescriptor(NSAppleEventDescriptor(enumCode: Self.fcc(form)), forKeyword: Self.fcc("form"))
        record.setDescriptor(seld, forKeyword: Self.fcc("seld"))
        record.setDescriptor(container ?? NSAppleEventDescriptor.null(), forKeyword: Self.fcc("from"))
        return record.coerce(toDescriptorType: Self.fcc("obj "))!
    }

    /// `every <class>` — absolute position with the `all` ordinal. The ordinal's OSType
    /// payload stays in native byte order (matches what AppleScript itself sends).
    private func every(_ classCode: String, in container: NSAppleEventDescriptor?) -> NSAppleEventDescriptor {
        var all = Self.fcc("all ")
        let ordinal = NSAppleEventDescriptor(descriptorType: Self.fcc("abso"), bytes: &all, length: 4)!
        return specifier(want: classCode, form: "indx", seld: ordinal, from: container)
    }

    /// `<class> id <id>` — Chrome accepts both text and integer ids; its sdef says text.
    private func byId(_ classCode: String, _ id: String, in container: NSAppleEventDescriptor?) -> NSAppleEventDescriptor {
        specifier(want: classCode, form: "ID  ", seld: NSAppleEventDescriptor(string: id), from: container)
    }

    /// `<property> of <container>`.
    private func property(_ code: String, of container: NSAppleEventDescriptor) -> NSAppleEventDescriptor {
        specifier(want: "prop", form: "prop",
                  seld: NSAppleEventDescriptor(typeCode: Self.fcc(code)), from: container)
    }

    // MARK: Sending

    private func send(class eventClass: String, id eventID: String,
                      params: [(String, NSAppleEventDescriptor)],
                      context: String) throws -> NSAppleEventDescriptor {
        let event = NSAppleEventDescriptor.appleEvent(
            withEventClass: Self.fcc(eventClass), eventID: Self.fcc(eventID),
            targetDescriptor: target,
            returnID: AEReturnID(kAutoGenerateReturnID),
            transactionID: AETransactionID(kAnyTransactionID))
        for (keyword, value) in params {
            event.setDescriptor(value, forKeyword: Self.fcc(keyword))
        }
        let reply: NSAppleEventDescriptor
        do {
            reply = try event.sendEvent(options: [.waitForReply], timeout: 2.0)
        } catch {
            throw AEFailure(context: context, detail: "send failed: \(error.localizedDescription)")
        }
        if let errn = reply.paramDescriptor(forKeyword: Self.fcc("errn")), errn.int32Value != 0 {
            let errs = reply.paramDescriptor(forKeyword: Self.fcc("errs"))?.stringValue ?? ""
            throw AEFailure(context: context, detail: "Chrome error \(errn.int32Value) \(errs)")
        }
        return reply
    }

    private func getStrings(_ what: NSAppleEventDescriptor, context: String) throws -> [String] {
        let reply = try send(class: "core", id: "getd", params: [("----", what)], context: context)
        guard let result = reply.paramDescriptor(forKeyword: Self.fcc("----")) else { return [] }
        return Self.stringItems(of: result)
    }

    /// Flattens a reply into strings: handles a list, a single value, and ids that arrive
    /// as integers even though the sdef declares text.
    private static func stringItems(of desc: NSAppleEventDescriptor) -> [String] {
        guard desc.descriptorType == fcc("list") else { return [stringValue(of: desc)] }
        return (1...max(desc.numberOfItems, 0)).compactMap { i in
            desc.atIndex(i).map { stringValue(of: $0) }
        }
    }

    private static func stringValue(of desc: NSAppleEventDescriptor) -> String {
        desc.stringValue ?? String(desc.int32Value)
    }

    // MARK: Chrome operations

    /// Ids of all windows, front to back.
    func windowIds() throws -> [String] {
        try getStrings(property("ID  ", of: every("cwin", in: nil)), context: "window ids")
    }

    /// A property (`ID  `, `pnam`, `URL `) of every tab in the given window.
    func tabProperty(_ code: String, windowId: String) throws -> [String] {
        try getStrings(property(code, of: every("CrTb", in: byId("cwin", windowId, in: nil))),
                       context: "tab \(code.trimmingCharacters(in: .whitespaces)) of window \(windowId)")
    }

    /// 1-based index of the window's active tab.
    func activeTabIndex(windowId: String) throws -> Int? {
        let values = try getStrings(property("acTI", of: byId("cwin", windowId, in: nil)),
                                    context: "active tab index of window \(windowId)")
        return values.first.flatMap(Int.init)
    }

    /// 1-based active tab index of the given window (`set active tab index of window id W to i`).
    func setActiveTabIndex(_ index: Int, windowId: String) throws {
        _ = try send(class: "core", id: "setd",
                     params: [("----", property("acTI", of: byId("cwin", windowId, in: nil))),
                              ("data", NSAppleEventDescriptor(int32: Int32(index)))],
                     context: "set active tab index of window \(windowId)")
    }

    /// Raises the window within Chrome (`set index of window id W to 1`).
    func raiseWindow(_ windowId: String) throws {
        _ = try send(class: "core", id: "setd",
                     params: [("----", property("pidx", of: byId("cwin", windowId, in: nil))),
                              ("data", NSAppleEventDescriptor(int32: 1))],
                     context: "raise window \(windowId)")
    }
}
