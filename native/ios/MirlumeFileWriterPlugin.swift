import Foundation
import Capacitor

/// Streams incoming DM files into Documents/Mirlume on iOS.
/// Files become visible in Files > On My iPhone > Mirlume when
/// UIFileSharingEnabled and LSSupportsOpeningDocumentsInPlace are enabled.
/// Keeps only the current 16 KiB WebRTC chunk in memory.
@objc(MirlumeFileWriterPlugin)
public class MirlumeFileWriterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MirlumeFileWriterPlugin"
    public let jsName = "MirlumeFileWriter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private struct Transfer {
        var tempURL: URL
        var finalURL: URL
        var handle: FileHandle
        var written: Int64
        var expected: Int64
    }
    private var transfers: [String: Transfer] = [:]
    private let maximum: Int64 = 20 * 1024 * 1024 * 1024

    @objc func start(_ call: CAPPluginCall) {
        guard let size = call.getDouble("size"),
              size.isFinite, size >= 1, size <= Double(maximum),
              floor(size) == size else {
            call.reject("Invalid file size")
            return
        }
        let expected = Int64(size)
        let supplied = call.getString("filename") ?? "download.bin"
        let raw = (supplied as NSString).lastPathComponent
        let cleaned = raw.replacingOccurrences(
            of: "[/\\\\:\\u{0000}-\\u{001F}]",
            with: "_", options: .regularExpression
        )
        let fileName = String(cleaned.prefix(120))
        let name = fileName.isEmpty ? "download.bin" : fileName
        let stem = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        let suffix = "-" + UUID().uuidString.prefix(10)
        let unique = stem + suffix + (ext.isEmpty ? "" : "." + ext)

        do {
            let home = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let folder = home.appendingPathComponent("Mirlume", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let attrs = try FileManager.default.attributesOfFileSystem(forPath: folder.path)
            let available = (attrs[.systemFreeSize] as? NSNumber)?.int64Value ?? 0
            if available < expected + 100 * 1024 * 1024 {
                call.reject("Insufficient device storage for this download")
                return
            }
            let finalURL = folder.appendingPathComponent(unique)
            let partialURL = folder.appendingPathComponent(unique + ".partial")
            guard FileManager.default.createFile(atPath: partialURL.path, contents: nil) else {
                call.reject("Unable to create temporary download")
                return
            }
            let handle = try FileHandle(forWritingTo: partialURL)
            let id = UUID().uuidString
            transfers[id] = Transfer(tempURL: partialURL, finalURL: finalURL,
                                     handle: handle, written: 0, expected: expected)
            call.resolve(["id": id, "filename": unique, "location": "Files / On My iPhone / Mirlume"])
        } catch {
            call.reject("Could not start file download: \(error.localizedDescription)")
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), var transfer = transfers[id],
              let chunk = call.getString("chunk"),
              chunk.utf8.count <= 100_000,
              let bytes = Data(base64Encoded: chunk) else {
            call.reject("Invalid download chunk")
            return
        }
        guard transfer.written + Int64(bytes.count) <= transfer.expected else {
            call.reject("Download exceeded announced size")
            return
        }
        do {
            try transfer.handle.write(contentsOf: bytes)
            transfer.written += Int64(bytes.count)
            transfers[id] = transfer
            call.resolve(["written": transfer.written])
        } catch {
            call.reject("Failed to write chunk: \(error.localizedDescription)")
        }
    }

    @objc func finish(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let transfer = transfers[id] else {
            call.reject("Unknown download")
            return
        }
        guard transfer.written == transfer.expected else {
            call.reject("File download is incomplete")
            return
        }
        do {
            try transfer.handle.close()
            try FileManager.default.moveItem(at: transfer.tempURL, to: transfer.finalURL)
            transfers.removeValue(forKey: id)
            call.resolve(["saved": true, "size": transfer.written])
        } catch {
            call.reject("Could not finalize download: \(error.localizedDescription)")
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let transfer = transfers.removeValue(forKey: id)
        else { call.resolve(); return }
        try? transfer.handle.close()
        try? FileManager.default.removeItem(at: transfer.tempURL)
        call.resolve()
    }

    override public func load() {
        // An interrupted background session should never expose a partial file as complete.
        let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Mirlume", isDirectory: true)
        if let entries = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) {
            for url in entries where url.pathExtension == "partial" {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }
}
