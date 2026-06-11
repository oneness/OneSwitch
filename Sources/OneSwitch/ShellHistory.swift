import Foundation

/// Reads the user's shell history files as recent, unique commands for command mode.
struct ShellHistory {
    static func recentCommands(limit: Int = 200) -> [String] {
        let fileManager = FileManager.default
        let home = fileManager.homeDirectoryForCurrentUser
        var files = [
            home.appendingPathComponent(".bash_history"),
            home.appendingPathComponent(".zsh_history")
        ]

        for directoryName in [".bash_sessions", ".zsh_sessions"] {
            let sessions = home.appendingPathComponent(directoryName)
            if let sessionFiles = try? fileManager.contentsOfDirectory(
                at: sessions,
                includingPropertiesForKeys: [.contentModificationDateKey],
                options: []
            ) {
                files += sessionFiles
                    .filter { ["history", "historynew", "session"].contains($0.pathExtension) }
                    .sorted { modificationDate($0) < modificationDate($1) }
            }
        }

        var commands: [String] = []
        for file in files {
            guard let data = try? Data(contentsOf: file),
                  let text = String(data: data, encoding: .utf8) else { continue }
            commands += parse(text)
        }

        var seen = Set<String>()
        var recent: [String] = []
        for command in commands.reversed() {
            guard !seen.contains(command) else { continue }
            seen.insert(command)
            recent.append(command)
            if recent.count == limit { break }
        }
        return recent
    }

    private static func parse(_ text: String) -> [String] {
        text
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: "\r")) }
            .map(stripZshMetadata)
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            .filter { !isTimestampLine($0) }
    }

    private static func stripZshMetadata(_ line: String) -> String {
        guard line.hasPrefix(": "), let separator = line.firstIndex(of: ";") else { return line }
        return String(line[line.index(after: separator)...])
    }

    private static func isTimestampLine(_ line: String) -> Bool {
        guard line.first == "#", line.dropFirst().allSatisfy(\.isNumber) else { return false }
        return line.count >= 10
    }

    private static func modificationDate(_ url: URL) -> Date {
        ((try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate) ?? .distantPast
    }
}
