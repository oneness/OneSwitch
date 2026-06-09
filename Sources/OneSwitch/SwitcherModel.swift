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
        guard !query.isEmpty else { return items }
        let q = query.lowercased()
        return items.filter {
            $0.title.lowercased().contains(q) || $0.ownerName.lowercased().contains(q)
        }
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
