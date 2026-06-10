import Foundation

/// Appends timestamped diagnostics to ~/Library/Logs/OneSwitch.log (and stderr, for when the
/// app is run from a terminal). The app normally runs headless with stderr at /dev/null, so
/// the log file is the only place AppleScript/permission failures stay visible.
enum AppLog {
    private static let fileURL: URL = {
        let dir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Logs", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("OneSwitch.log")
        // Errors-only log; a runaway failure loop could still grow it, so cap it.
        if let size = try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int,
           size > 5_000_000 {
            try? FileManager.default.removeItem(at: url)
        }
        return url
    }()

    private static let queue = DispatchQueue(label: "oneswitch.applog")

    private static let timestamp: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()

    static func log(_ message: String) {
        let line = "\(timestamp.string(from: Date())) \(message)\n"
        let data = line.data(using: .utf8)!
        FileHandle.standardError.write(data)
        // Synchronous so lines survive an exit(0) right after logging (diagnostic modes);
        // error-only volume makes the cost irrelevant.
        queue.sync {
            if let handle = try? FileHandle(forWritingTo: fileURL) {
                defer { try? handle.close() }
                handle.seekToEndOfFile()
                handle.write(data)
            } else {
                try? data.write(to: fileURL)
            }
        }
    }
}
