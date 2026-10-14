import AppKit
import CoreImage
import ImageIO
import ScreenCaptureKit

private let protocolVersion = 1

private func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
    FileHandle.standardOutput.write(data + Data([10]))
}

private func fail(_ error: Error) -> Never {
    let failure = captureFailure(error)
    emit([
        "type": "error", "protocol": protocolVersion,
        "code": failure.code,
        "message": failure.description,
    ])
    exit(1)
}

private func captureFailure(_ error: Error) -> CaptureFailure {
    if let failure = error as? CaptureFailure { return failure }
    let native = error as NSError
    return CaptureFailure(
        code: native.domain == SCStreamErrorDomain ? captureErrorCode(native.code) : "capture_stopped",
        description: "\(native.domain) (\(native.code)): \(native.localizedDescription)"
    )
}

private func connectToHost(path: String, token: String) throws {
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8) + [0]
    guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path), token.count == 64 else {
        throw CaptureFailure(code: "invalid_request", description: "Invalid host socket")
    }
    withUnsafeMutableBytes(of: &address.sun_path) { destination in
        destination.copyBytes(from: bytes)
    }
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { throw CaptureFailure(code: "capture_failed", description: "Cannot create host connection") }
    let result = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard result == 0, dup2(fd, STDIN_FILENO) >= 0, dup2(fd, STDOUT_FILENO) >= 0 else {
        close(fd)
        throw CaptureFailure(code: "capture_stopped", description: "The DSH host is no longer available")
    }
    close(fd)
    emit(["type": "hello", "protocol": protocolVersion, "token": token, "pid": ProcessInfo.processInfo.processIdentifier])
}

@available(macOS 14.0, *)
private final class FrameOutput: NSObject, SCStreamOutput, @unchecked Sendable {
    let queue = DispatchQueue(label: "dsh.window-capture.frames", qos: .userInitiated)
    private let context = CIContext(options: [.cacheIntermediates: false])
    private var sequence = 0
    private var metadata: [String: Any] = [:]
    private var sampleStatus = "starting"
    private var sampleAt = 0.0

    func update(_ info: [String: Any]) {
        queue.sync { metadata = info }
    }

    func heartbeat() {
        queue.async {
            emit([
                "protocol": protocolVersion, "type": "status",
                "pid": self.metadata["pid"] ?? 0, "windowId": self.metadata["windowId"] ?? 0,
                "status": self.sampleStatus, "sampleAt": self.sampleAt,
            ])
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let status = attachments.first?[.status] as? Int else { return }
        sampleAt = Date().timeIntervalSince1970 * 1000
        switch SCFrameStatus(rawValue: status) {
        case .complete: sampleStatus = "complete"
        case .idle: sampleStatus = "idle"
        case .blank: sampleStatus = "blank"
        case .suspended: sampleStatus = "suspended"
        default: sampleStatus = "starting"
        }
        guard status == SCFrameStatus.complete.rawValue, let pixels = sample.imageBuffer else { return }
        autoreleasepool {
            let image = CIImage(cvPixelBuffer: pixels)
            guard let jpeg = context.jpegRepresentation(
                of: image,
                colorSpace: CGColorSpaceCreateDeviceRGB(),
                options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.75]
            ) else { return }
            sequence += 1
            var message = metadata
            message["type"] = "frame"
            message["protocol"] = protocolVersion
            message["source"] = "screencapturekit-window"
            message["sequence"] = sequence
            message["capturedAt"] = sampleAt
            message["presentationTime"] = sample.presentationTimeStamp.seconds
            message["width"] = CVPixelBufferGetWidth(pixels)
            message["height"] = CVPixelBufferGetHeight(pixels)
            message["mime"] = "image/jpeg"
            message["base64"] = jpeg.base64EncodedString()
            emit(message)
        }
    }
}

@available(macOS 14.0, *)
@MainActor
private final class WindowCapture: NSObject, SCStreamDelegate {
    private let request: CaptureRequest
    private let output = FrameOutput()
    private var stream: SCStream?
    private var stopping = false
    private var monitor: Task<Void, Never>?
    private var outputSize = (0, 0)
    private var scale = 1.0

    init(request: CaptureRequest) { self.request = request }

    func start() async throws {
        // A denied permission must not trigger repeated consent prompts from a
        // background watcher. Permission requests are an explicit separate command.
        guard CGPreflightScreenCaptureAccess() else {
            throw CaptureFailure(
                code: "permission_denied",
                description: "Allow DSH Window Capture in System Settings > Privacy & Security > Screen & System Audio Recording, then reopen the preview"
            )
        }
        let window = try await currentWindow()
        // This is the only capture filter. There is no display source, desktop
        // crop, activation, AXRaise, or fallback to a foreground screenshot.
        let filter = SCContentFilter(desktopIndependentWindow: window)
        scale = Double(filter.pointPixelScale)
        let info = try windowInfo(window)
        output.update(info.metadata)
        outputSize = try captureSize(width: info.bounds.width, height: info.bounds.height, scale: scale, limit: request.maxDimension)
        let stream = SCStream(filter: filter, configuration: configuration(outputSize), delegate: self)
        self.stream = stream
        try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: output.queue)
        try await stream.startCapture()
        monitor = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
                do {
                    let current = try await self.currentWindow()
                    if Task.isCancelled { return }
                    let info = try self.windowInfo(current)
                    let size = try captureSize(width: info.bounds.width, height: info.bounds.height, scale: self.scale, limit: self.request.maxDimension)
                    if size != self.outputSize {
                        try await stream.updateConfiguration(self.configuration(size))
                        self.outputSize = size
                    }
                    self.output.update(info.metadata)
                    self.output.heartbeat()
                } catch {
                    await self.stop(error: error)
                    return
                }
            }
        }
    }

    private func configuration(_ size: (Int, Int)) -> SCStreamConfiguration {
        let config = SCStreamConfiguration()
        config.width = size.0
        config.height = size.1
        config.minimumFrameInterval = CMTime(value: 1, timescale: Int32(request.fps))
        config.queueDepth = 3
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = false
        config.capturesAudio = false
        config.ignoreShadowsSingleWindow = true
        config.scalesToFit = true
        config.preservesAspectRatio = true
        config.streamName = "DSH application preview"
        if #available(macOS 15.0, *) { config.captureMicrophone = false }
        return config
    }

    private func currentWindow() async throws -> SCWindow {
        // Read metadata from the same authorized API as the pixel source.
        // A failed CGWindowList dictionary cast is not proof a window closed.
        guard CGPreflightScreenCaptureAccess() else {
            throw CaptureFailure(code: "permission_denied", description: "Screen recording permission was revoked")
        }
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
        guard let window = content.windows.first(where: { $0.windowID == request.windowID }) else {
            throw CaptureFailure(code: "window_gone", description: "The selected window is temporarily unavailable or has closed")
        }
        return window
    }

    private func windowInfo(_ window: SCWindow) throws -> (bounds: CGRect, metadata: [String: Any]) {
        guard let owner = window.owningApplication else {
            throw CaptureFailure(code: "capture_interrupted", description: "Window ownership metadata is unavailable")
        }
        try validateCaptureOwner(request: request, pid: owner.processID, windowID: window.windowID, layer: window.windowLayer)
        let bounds = window.frame
        return (bounds, [
            "pid": owner.processID, "windowId": window.windowID,
            "appName": owner.applicationName,
            "windowTitle": window.title ?? "",
            "windowBounds": ["x": bounds.minX, "y": bounds.minY, "width": bounds.width, "height": bounds.height],
        ])
    }

    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        Task { await stop(error: captureFailure(error)) }
    }

    func stop(error: Error? = nil) async {
        guard !stopping else { return }
        stopping = true
        monitor?.cancel()
        try? await stream?.stopCapture()
        output.queue.sync {}
        if let error { fail(error) }
        exit(0)
    }
}

@main
private enum Main {
    @MainActor
    static func main() {
        signal(SIGPIPE, SIG_DFL)
        var args = Array(CommandLine.arguments.dropFirst())
        if args.first == "--ipc" {
            guard args.count >= 4, args[2] == "--token" else {
                fail(CaptureFailure(code: "invalid_request", description: "Invalid host connection arguments"))
            }
            do { try connectToHost(path: args[1], token: args[3]) } catch { fail(error) }
            args.removeFirst(4)
        }
        if args == ["--probe"] {
            emit(["protocol": protocolVersion, "source": "screencapturekit-window", "screenRecording": CGPreflightScreenCaptureAccess()])
            return
        }
        if args == ["--request-permission"] {
            emit(["screenRecording": CGRequestScreenCaptureAccess()])
            return
        }
        guard #available(macOS 14.0, *) else {
            fail(CaptureFailure(code: "unsupported_platform", description: "Window capture requires macOS 14 or later"))
        }
        do {
            let request = try CaptureRequest(arguments: args)
            let capture = WindowCapture(request: request)
            Task {
                do { try await capture.start() } catch { fail(error) }
            }
            // stdin belongs to the plugin host: EOF also tears down the stream
            // after a host crash, without an orphan recorder or daemon.
            DispatchQueue.global().async {
                while let command = readLine() {
                    if command == "stop" { break }
                }
                Task { await capture.stop() }
            }
            dispatchMain()
        } catch { fail(error) }
    }
}
