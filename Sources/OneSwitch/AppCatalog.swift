import AppKit

/// An installed (not necessarily running) application bundle.
struct InstalledApp {
    let name: String
    let url: URL
    let icon: NSImage
}

/// Scans the standard application directories for launchable .app bundles. Results are
/// cached and rescanned only when a directory's modification date changes (installs and
/// removals touch the parent directory).
final class AppCatalog {
    private static let directories: [URL] = [
        URL(fileURLWithPath: "/Applications", isDirectory: true),
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true),
        URL(fileURLWithPath: "/System/Applications", isDirectory: true),
    ]

    private var cache: [InstalledApp] = []
    private var scannedStamps: [String: Date] = [:]

    func apps() -> [InstalledApp] {
        let stamps = Self.currentStamps()
        if stamps != scannedStamps {
            cache = Self.scan()
            scannedStamps = stamps
        }
        return cache
    }

    private static func currentStamps() -> [String: Date] {
        var stamps = [String: Date]()
        for dir in directories {
            stamps[dir.path] = (try? FileManager.default
                .attributesOfItem(atPath: dir.path)[.modificationDate]) as? Date
        }
        return stamps
    }

    /// Walks each directory one subfolder deep (covers /Applications/Utilities and the
    /// like). Duplicate names keep the first hit, so the directory order above is the
    /// priority order.
    private static func scan() -> [InstalledApp] {
        let fm = FileManager.default
        var apps = [InstalledApp]()
        var seenNames = Set<String>()

        for dir in directories {
            guard let entries = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil,
                                                            options: [.skipsHiddenFiles]) else { continue }
            var bundles = [URL]()
            for entry in entries {
                if entry.pathExtension == "app" {
                    bundles.append(entry)
                } else if (try? entry.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true,
                          let nested = try? fm.contentsOfDirectory(at: entry, includingPropertiesForKeys: nil,
                                                                   options: [.skipsHiddenFiles]) {
                    bundles.append(contentsOf: nested.filter { $0.pathExtension == "app" })
                }
            }
            for bundle in bundles {
                let name = fm.displayName(atPath: bundle.path)
                guard seenNames.insert(name.lowercased()).inserted else { continue }
                apps.append(InstalledApp(name: name, url: bundle,
                                         icon: NSWorkspace.shared.icon(forFile: bundle.path)))
            }
        }
        return apps
    }
}
