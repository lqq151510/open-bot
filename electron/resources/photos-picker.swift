import AppKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

@available(macOS 13.0, *)
@MainActor
private final class PhotoSelection: NSObject, NSApplicationDelegate, NSWindowDelegate, PHPickerViewControllerDelegate {
    struct Result: Encodable {
        let status: String
        var count = 0
        var skipped = 0
    }

    private let directory: URL
    private let limit: Int
    private let title: String
    private let loading: String
    private var remainingBytes: Int
    private var window: NSWindow?
    private var finished = false
    private var importing = false

    init(directory: URL, limit: Int, bytes: Int, title: String, loading: String) {
        self.directory = directory
        self.limit = limit
        self.remainingBytes = bytes
        self.title = title
        self.loading = loading
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
        configuration.selectionLimit = limit
        configuration.selection = .ordered
        configuration.preferredAssetRepresentationMode = .compatible
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 800, height: 560),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.contentViewController = picker
        window.setContentSize(NSSize(width: 800, height: 560))
        window.minSize = NSSize(width: 560, height: 420)
        window.title = title
        window.delegate = self
        self.window = window
        window.center()
        window.makeKeyAndOrderFront(nil)
        if #available(macOS 14, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func windowWillClose(_ notification: Notification) {
        finish(Result(status: "cancelled"))
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        guard !finished, !importing else { return }
        guard !results.isEmpty else { finish(Result(status: "cancelled")); return }
        importing = true
        window?.title = loading
        window?.contentViewController = NSHostingController(rootView:
            ProgressView(loading).frame(maxWidth: .infinity, maxHeight: .infinity).padding(28)
        )
        Task { await export(results) }
    }

    private func export(_ results: [PHPickerResult]) async {
        var count = 0
        for result in results.prefix(limit) {
            guard !finished else { return }
            guard remainingBytes > 0, let data = await jpeg(result.itemProvider), !finished,
                  data.count <= min(remainingBytes, 10 * 1024 * 1024) else { continue }
            let output = directory.appendingPathComponent("photo-\(count + 1).jpg")
            if (try? data.write(to: output, options: .atomic)) != nil {
                count += 1
                remainingBytes -= data.count
            }
        }
        finish(Result(status: "selected", count: count, skipped: results.count - count))
    }

    private func jpeg(_ provider: NSItemProvider) async -> Data? {
        guard let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .image) == true }) else { return nil }
        return await withCheckedContinuation { continuation in
            _ = provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                continuation.resume(returning: url.flatMap { photoJPEG(at: $0) })
            }
        }
    }

    private func finish(_ result: Result) {
        guard !finished else { return }
        finished = true
        do {
            try JSONEncoder().encode(result).write(to: directory.appendingPathComponent("result.json"), options: .atomic)
        } catch {
            exit(1)
        }
        NSApp.terminate(nil)
    }
}

@main
struct OpenBotPhotos {
    @MainActor
    static func main() {
        let args = CommandLine.arguments
        guard #available(macOS 13.0, *), args.count == 6,
              let limit = Int(args[2]), (1...10).contains(limit),
              let bytes = Int(args[3]), (1...(40 * 1024 * 1024)).contains(bytes) else { exit(2) }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let selection = PhotoSelection(directory: URL(fileURLWithPath: args[1], isDirectory: true), limit: limit,
                                       bytes: bytes, title: args[4], loading: args[5])
        app.delegate = selection
        withExtendedLifetime(selection) { app.run() }
    }
}
