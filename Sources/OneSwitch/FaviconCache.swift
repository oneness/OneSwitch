import AppKit
import Combine
import CryptoKit

/// Two-tier favicon cache: in-memory for instant repeat access, on-disk so icons survive
/// relaunches (no re-fetch). `icon(for:)` returns the in-memory image immediately if present;
/// otherwise it resolves off the main thread (disk first, then network) and publishes a change
/// when ready so observing views re-render and pick it up.
final class FaviconCache: ObservableObject {
    static let shared = FaviconCache()

    private var images: [String: NSImage] = [:]      // main-thread only
    private var inFlight: Set<String> = []           // main-thread only
    private let ioQueue = DispatchQueue(label: "health.legion.OneSwitch.favicon-io", qos: .utility)
    private let dir: URL

    init() {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        dir = base.appendingPathComponent("health.legion.OneSwitch/favicons", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    /// Disk filename = SHA-256 of the favicon URL (stable, filesystem-safe).
    private func fileURL(for key: String) -> URL {
        let digest = SHA256.hash(data: Data(key.utf8))
        return dir.appendingPathComponent(digest.map { String(format: "%02x", $0) }.joined())
    }

    func icon(for url: URL) -> NSImage? {
        let key = url.absoluteString
        if let image = images[key] { return image }
        guard !inFlight.contains(key) else { return nil }
        inFlight.insert(key)

        ioQueue.async { [weak self] in
            guard let self else { return }
            let file = self.fileURL(for: key)

            // 1. Disk hit -> use it, no network.
            if let data = try? Data(contentsOf: file), let image = NSImage(data: data) {
                self.store(image, key: key)
                return
            }
            // 2. Fetch, persist to disk, then cache in memory.
            URLSession.shared.dataTask(with: url) { data, _, _ in
                guard let data, let image = NSImage(data: data) else {
                    DispatchQueue.main.async { self.inFlight.remove(key) }
                    return
                }
                try? data.write(to: file)
                self.store(image, key: key)
            }.resume()
        }
        return nil
    }

    private func store(_ image: NSImage, key: String) {
        DispatchQueue.main.async {
            self.images[key] = image
            self.inFlight.remove(key)
            self.objectWillChange.send()
        }
    }
}
