import SwiftUI

/// Observable state backing the switcher popup.
final class SwitcherModel: ObservableObject {
    @Published var query: String = "" {
        didSet {
            selectedIndex = 0
            onQueryChanged?()
        }
    }
    @Published private(set) var items: [WindowItem] = []
    /// Installed-but-not-running apps; they join the pool only while searching.
    @Published private(set) var launchables: [WindowItem] = []
    @Published private(set) var commandHistory: [String] = []
    @Published var selectedIndex: Int = 0

    var onActivate: ((WindowItem) -> Void)?
    var onDismiss: (() -> Void)?
    var onRunCommand: ((String) -> Void)?
    var onQueryChanged: (() -> Void)?

    /// Command mode: a query starting with ">" is a shell command, not a search.
    var commandInput: String? {
        guard query.hasPrefix(">") else { return nil }
        return String(query.dropFirst()).trimmingCharacters(in: .whitespaces)
    }

    var commandSuggestions: [String] {
        guard let commandInput else { return [] }
        let tokens = commandInput.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
        let matching = commandHistory.filter { command in
            guard !tokens.isEmpty else { return true }
            let lowercased = command.lowercased()
            return tokens.allSatisfy { lowercased.contains($0) }
        }
        return Array(matching.prefix(80))
    }

    var filtered: [WindowItem] {
        guard commandInput == nil else { return [] }
        let tokens = query.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard !tokens.isEmpty else { return items }

        // Orderless: every token must appear (as a substring) somewhere in title+app, any order.
        return (items + launchables).compactMap { item -> (item: WindowItem, score: Double)? in
            let haystack = (item.title + " " + item.ownerName).lowercased()
            guard tokens.allSatisfy({ haystack.contains($0) }) else { return nil }
            return (item, Self.score(item: item, tokens: tokens))
        }
        .sorted { a, b in
            a.score != b.score ? a.score > b.score : a.item.title < b.item.title
        }
        .map { $0.item }
    }

    /// Higher is better. Rewards matches in the title over the app name, and prefers
    /// prefix / word-boundary matches that appear earlier; shorter titles break ties.
    private static func score(item: WindowItem, tokens: [String]) -> Double {
        let title = item.title.lowercased()
        let owner = item.ownerName.lowercased()
        let titleChars = Array(title)
        var total = 0.0

        for token in tokens {
            if let range = title.range(of: token) {
                let idx = title.distance(from: title.startIndex, to: range.lowerBound)
                var s = 30.0
                if idx == 0 {
                    s += 60                                   // matches at start of title
                } else if !titleChars[idx - 1].isLetter && !titleChars[idx - 1].isNumber {
                    s += 30                                   // matches at a word boundary
                }
                s -= Double(idx) * 0.2                        // earlier matches rank higher
                total += s
            } else if owner.contains(token) {
                total += 10                                   // matched only in the app name
            }
        }
        total -= Double(title.count) * 0.05                   // prefer shorter / more specific titles
        if item.isLaunchable { total -= 1000 }                // launchables rank below any open window/tab
        return total
    }

    func setItems(_ newItems: [WindowItem], launchables newLaunchables: [WindowItem] = []) {
        items = newItems
        launchables = newLaunchables
        query = ""
        selectedIndex = 0
    }

    func setCommandHistory(_ commands: [String]) {
        commandHistory = commands
        selectedIndex = min(selectedIndex, max(0, currentSelectionCount - 1))
    }

    /// Replace the item pool while the panel is open, preserving the query and keeping the
    /// selection on the same item where possible (used by the post-open refresh that picks
    /// up late-arriving AX data, e.g. a freshly launched Firefox's tabs).
    func refreshItems(_ newItems: [WindowItem], launchables newLaunchables: [WindowItem]) {
        if commandInput != nil {
            items = newItems
            launchables = newLaunchables
            return
        }
        let selectedId = filtered.indices.contains(selectedIndex) ? filtered[selectedIndex].id : nil
        items = newItems
        launchables = newLaunchables
        if let selectedId, let index = filtered.firstIndex(where: { $0.id == selectedId }) {
            selectedIndex = index
        } else {
            selectedIndex = min(selectedIndex, max(0, filtered.count - 1))
        }
    }

    func moveSelection(_ delta: Int) {
        let count = currentSelectionCount
        guard count > 0 else { return }
        selectedIndex = (selectedIndex + delta + count) % count
    }

    func activateSelection() {
        let list = filtered
        guard selectedIndex >= 0, selectedIndex < list.count else { return }
        onActivate?(list[selectedIndex])
    }

    func dismiss() {
        onDismiss?()
    }

    func runSelectedCommand() {
        if let selected = selectedCommandSuggestion {
            runCommand(selected)
        } else if let commandInput {
            runCommand(commandInput)
        }
    }

    func runTypedCommand() {
        guard let commandInput else { return }
        runCommand(commandInput)
    }

    func runCommand(_ command: String) {
        let command = command.trimmingCharacters(in: .whitespaces)
        guard !command.isEmpty else { return }
        rememberCommand(command)
        onRunCommand?(command)
    }

    private var selectedCommandSuggestion: String? {
        let suggestions = commandSuggestions
        guard suggestions.indices.contains(selectedIndex) else { return nil }
        return suggestions[selectedIndex]
    }

    private var currentSelectionCount: Int {
        commandInput == nil ? filtered.count : commandSuggestions.count
    }

    private func rememberCommand(_ command: String) {
        commandHistory.removeAll { $0 == command }
        commandHistory.insert(command, at: 0)
        if commandHistory.count > 200 {
            commandHistory.removeLast(commandHistory.count - 200)
        }
    }
}
