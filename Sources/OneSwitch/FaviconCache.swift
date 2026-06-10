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

    /// Favicon for a page, keyed by host. Tries DuckDuckGo's favicon service first (good
    /// coverage, normalized sizes), then the site's own /favicon.ico (covers intranet and
    /// private hosts DuckDuckGo has never seen).
    func icon(forPage pageURL: URL) -> NSImage? {
        guard let host = pageURL.host else { return nil }
        let key = host
        if let image = images[key] { return image }
        guard !inFlight.contains(key) else { return nil }
        inFlight.insert(key)

        let candidates = [
            URL(string: "https://icons.duckduckgo.com/ip3/\(host).ico"),
            URL(string: "\(pageURL.scheme ?? "https")://\(host)/favicon.ico"),
        ].compactMap { $0 }

        ioQueue.async { [weak self] in
            guard let self else { return }
            let file = self.fileURL(for: key)

            // 1. Disk hit -> use it, no network.
            if let data = try? Data(contentsOf: file), let image = NSImage(data: data) {
                self.store(image, key: key)
                return
            }
            // 2. Fetch the first candidate that yields a decodable image, persist, cache.
            self.fetchFirst(candidates, file: file, key: key)
        }
        return nil
    }

    private func fetchFirst(_ candidates: [URL], file: URL, key: String) {
        guard let url = candidates.first else {
            DispatchQueue.main.async { self.inFlight.remove(key) }
            return
        }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            if let data, let image = NSImage(data: data), image.isValid {
                try? data.write(to: file)
                self.store(image, key: key)
            } else {
                self.fetchFirst(Array(candidates.dropFirst()), file: file, key: key)
            }
        }.resume()
    }

    private func store(_ image: NSImage, key: String) {
        DispatchQueue.main.async {
            self.images[key] = image
            self.inFlight.remove(key)
            self.objectWillChange.send()
        }
    }
}
