import Foundation

struct CaptureFailure: Error, CustomStringConvertible {
    let code: String
    let description: String
}

// Values from the installed ScreenCaptureKit SCError.h. Unknown failures stop
// rather than guessing that restarting is permitted.
func captureErrorCode(_ nativeCode: Int) -> String {
    switch nativeCode {
    case -3801, -3803: return "permission_denied"
    case -3817, -3821: return "capture_stopped"
    case -3802, -3804, -3805, -3806, -3811, -3813, -3815: return "capture_interrupted"
    default: return "capture_stopped"
    }
}

struct CaptureRequest {
    let pid: Int32
    let windowID: UInt32
    let maxDimension: Int
    let fps: Int

    init(arguments: [String]) throws {
        var values: [String: String] = [:]
        let allowed = ["--pid", "--window-id", "--max-dimension", "--fps"]
        guard arguments.count == 8 else {
            throw CaptureFailure(code: "invalid_request", description: "Expected an exact pid/window-id, max-dimension and fps")
        }
        for index in stride(from: 0, to: arguments.count, by: 2) {
            let key = arguments[index]
            guard allowed.contains(key), values[key] == nil else {
                throw CaptureFailure(code: "invalid_request", description: "Unknown or duplicate capture argument")
            }
            values[key] = arguments[index + 1]
        }
        guard let pid = Int32(values["--pid"] ?? ""), pid > 0,
              let windowID = UInt32(values["--window-id"] ?? ""), windowID > 0,
              let dimension = Int(values["--max-dimension"] ?? ""), (64...2048).contains(dimension),
              let fps = Int(values["--fps"] ?? ""), (1...30).contains(fps) else {
            throw CaptureFailure(code: "invalid_request", description: "Capture identifiers or limits are out of range")
        }
        self.pid = pid
        self.windowID = windowID
        self.maxDimension = dimension
        self.fps = fps
    }
}

func captureSize(width: Double, height: Double, scale: Double, limit: Int) throws -> (Int, Int) {
    guard width.isFinite, height.isFinite, scale.isFinite, width > 0, height > 0,
          scale > 0, (64...2048).contains(limit) else {
        throw CaptureFailure(code: "capture_failed", description: "Invalid window dimensions")
    }
    let factor = min(scale, Double(limit) / max(width, height))
    return (max(1, Int((width * factor).rounded())), max(1, Int((height * factor).rounded())))
}

func validateCaptureOwner(request: CaptureRequest, pid: Int32, windowID: UInt32, layer: Int) throws {
    guard pid == request.pid, windowID == request.windowID, layer == 0 else {
        throw CaptureFailure(code: "window_gone", description: "The exact application window is no longer available")
    }
}
