import AppKit
import Combine

/// Runs one-shot shell commands for the switcher's command mode (`> cmd`). Output
/// (stdout+stderr interleaved, like a terminal) is published for the panel and copied to
/// the clipboard on completion. No TTY: interactive commands and sudo won't work.
final class CommandRunner: ObservableObject {
    enum State {
        case idle
        case running(command: String)
        case finished(command: String, output: String, exitCode: Int32)
    }

    @Published private(set) var state: State = .idle
    private var process: Process?
    private var generation = 0          // invalidates results of cancelled runs

    var isRunning: Bool { if case .running = state { return true } else { return false } }

    func run(_ command: String) {
        cancel()
        generation += 1
        let expected = generation
        state = .running(command: command)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        // -l: login shell so the user's PATH and profile apply.
        process.arguments = ["-lc", command]
        process.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        process.standardInput = FileHandle.nullDevice
        self.process = process

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var output: String
            var exitCode: Int32 = -1
            do {
                try process.run()
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                output = String(data: data, encoding: .utf8) ?? ""
                exitCode = process.terminationStatus
            } catch {
                output = "failed to launch: \(error.localizedDescription)"
            }
            if output.hasSuffix("\n") { output.removeLast() }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.generation == expected else { return }
                self.process = nil
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                pasteboard.setString(output, forType: .string)
                self.state = .finished(command: command, output: output, exitCode: exitCode)
            }
        }
    }

    /// Kill a run in flight (Esc). Late results from the killed process are discarded.
    func cancel() {
        generation += 1
        process?.terminate()
        process = nil
        if case .running = state { state = .idle }
    }

    func reset() {
        cancel()
        state = .idle
    }
}
