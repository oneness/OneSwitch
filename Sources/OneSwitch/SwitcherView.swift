import SwiftUI
import AppKit

struct SwitcherView: View {
    @ObservedObject var model: SwitcherModel
    @ObservedObject var runner: CommandRunner
    @ObservedObject private var favicons = FaviconCache.shared
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            TextField("Search windows, tabs & apps — or > cmd", text: $model.query)
                .textFieldStyle(.plain)
                .font(.system(size: 18))
                .padding(14)
                .focused($searchFocused)

            Divider()

            if model.commandInput != nil {
                commandView
            } else {
                itemList
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

    private var itemList: some View {
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

    /// Command mode (`> cmd`): hint, spinner, or the finished command's output.
    @ViewBuilder
    private var commandView: some View {
        switch runner.state {
        case .idle:
            VStack(spacing: 6) {
                Spacer()
                Text("↩ runs in bash")
                    .foregroundStyle(.secondary)
                Text("Output is shown here and copied to the clipboard. Esc cancels a running command.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                Spacer()
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)

        case .running(let command):
            VStack(spacing: 10) {
                Spacer()
                ProgressView()
                Text(command)
                    .font(.system(.caption, design: .monospaced))
                    .lineLimit(2)
                    .foregroundStyle(.secondary)
                Text("Esc to cancel")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                Spacer()
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)

        case .finished(let command, let output, let exitCode):
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(command)
                        .font(.system(.caption, design: .monospaced))
                        .lineLimit(1)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(exitCode == 0 ? "exit 0 · copied" : "exit \(exitCode) · copied")
                        .font(.caption)
                        .foregroundStyle(exitCode == 0 ? Color.secondary : Color.orange)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                Divider()
                ScrollView {
                    // Cap what's rendered (the clipboard always has the full output).
                    Text(output.isEmpty ? "(no output)" : String(output.suffix(20_000)))
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                }
            }
        }
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
