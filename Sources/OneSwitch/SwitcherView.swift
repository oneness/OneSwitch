import SwiftUI
import AppKit

struct SwitcherView: View {
    @ObservedObject var model: SwitcherModel
    @ObservedObject private var favicons = FaviconCache.shared
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            TextField("Search windows, tabs & apps…", text: $model.query)
                .textFieldStyle(.plain)
                .font(.system(size: 18))
                .padding(14)
                .focused($searchFocused)

            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(model.filtered.enumerated()), id: \.offset) { idx, item in
                            row(item, selected: idx == model.selectedIndex)
                                .id(idx)
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    model.selectedIndex = idx
                                    model.activateSelection()
                                }
                        }
                    }
                }
                .onChange(of: model.selectedIndex) { newValue in
                    withAnimation(.easeOut(duration: 0.1)) {
                        proxy.scrollTo(newValue, anchor: .center)
                    }
                }
            }
        }
        .frame(width: 600, height: 420)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
        )
        .onAppear { searchFocused = true }
    }

    @ViewBuilder
    private func row(_ item: WindowItem, selected: Bool) -> some View {
        HStack(spacing: 10) {
            Group {
                if let page = item.pageURL, let img = favicons.icon(forPage: page) {
                    Image(nsImage: img)            // page favicon (loads async, then swaps in)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                } else if let icon = item.icon {
                    Image(nsImage: icon)           // app icon (also the placeholder for tabs)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                } else {
                    Image(systemName: item.isTab ? "globe" : "macwindow")
                        .foregroundStyle(selected ? Color.white : Color.secondary)
                }
            }
            .frame(width: 22, height: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .lineLimit(1)
                    .foregroundStyle(selected ? Color.white : Color.primary)
                Text(item.ownerName)
                    .font(.caption)
                    .foregroundStyle(selected ? Color.white.opacity(0.8) : Color.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(selected ? Color.accentColor.opacity(0.85) : Color.clear)
    }
}
