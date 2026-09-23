import Foundation

final class PresetStore {
    let directory: URL
    private var pendingSession: String?
    private var delayedWrite: DispatchWorkItem?
    var onError: ((Error) -> Void)?
    init(directory: URL? = nil) throws {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Chroma Console Studio", isDirectory: true)
        try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
    }
    func read(_ name: String) throws -> String? {
        let url = directory.appendingPathComponent(name + ".json")
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let text = try String(contentsOf: url, encoding: .utf8)
        if name == "library" { try Safety.library(text) } else { try Safety.session(text) }
        return text
    }
    func saveLibrary(_ text: String) throws {
        try Safety.library(text)
        let url = directory.appendingPathComponent("library.json")
        if let previous = try read("library"), previous != text {
            try previous.write(to: directory.appendingPathComponent("library.previous.json"), atomically: true, encoding: .utf8)
        }
        try text.write(to: url, atomically: true, encoding: .utf8)
    }
    func saveSession(_ text: String) throws {
        try Safety.session(text)
        pendingSession = text
        delayedWrite?.cancel()
        let work = DispatchWorkItem { [weak self] in
            do { try self?.flush() } catch { self?.onError?(error) }
        }
        delayedWrite = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
    }
    func flush() throws {
        delayedWrite?.cancel(); delayedWrite = nil
        guard let text = pendingSession else { return }
        try text.write(to: directory.appendingPathComponent("session.json"), atomically: true, encoding: .utf8)
        pendingSession = nil
    }
}
