import SwiftUI

/// Observable state backing the switcher popup.
final class SwitcherModel: ObservableObject {
    @Published var query: String = "" {
        didSet { selectedIndex = 0 }
    }
    @Published private(set) var items: [WindowItem] = []
    @Published var selectedIndex: Int = 0

    var onActivate: ((WindowItem) -> Void)?
    var onDismiss: (() -> Void)?

    var filtered: [WindowItem] {
        let tokens = query.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard !tokens.isEmpty else { return items }

        // Orderless: every token must appear (as a substring) somewhere in title+app, any order.
        return items.compactMap { item -> (item: WindowItem, score: Double)? in
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
        return total
    }

    func setItems(_ newItems: [WindowItem]) {
        items = newItems
        query = ""
        selectedIndex = 0
    }

    func moveSelection(_ delta: Int) {
        let count = filtered.count
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
}
