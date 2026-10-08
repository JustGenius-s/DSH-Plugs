import Foundation

@main
enum CaptureContractTests {
    static func main() throws {
        let args = ["--pid", "42", "--window-id", "73", "--max-dimension", "1024", "--fps", "30"]
        let request = try CaptureRequest(arguments: args)
        precondition(request.pid == 42 && request.windowID == 73)
        try validateCaptureOwner(request: request, pid: 42, windowID: 73, layer: 0)
        let landscape = try captureSize(width: 1200, height: 800, scale: 2, limit: 1024)
        let portrait = try captureSize(width: 300, height: 900, scale: 2, limit: 1024)
        let small = try captureSize(width: 200, height: 100, scale: 2, limit: 1024)
        precondition(landscape == (1024, 683))
        precondition(portrait == (341, 1024))
        precondition(small == (400, 200))
        for (index, value) in [(1, "0"), (1, "2147483648"), (3, "-1"), (3, "4294967296"), (5, "9999"), (7, "31"), (0, "--display-id")] {
            var invalid = args
            invalid[index] = value
            do {
                _ = try CaptureRequest(arguments: invalid)
                fatalError("Accepted invalid request")
            } catch is CaptureFailure {}
        }
        for (pid, id, layer): (Int32, UInt32, Int) in [(43, 73, 0), (42, 74, 0), (42, 73, 1)] {
            do {
                try validateCaptureOwner(request: request, pid: pid, windowID: id, layer: layer)
                fatalError("Accepted a different window")
            } catch is CaptureFailure {}
        }
        for code in [-3801, -3803] { precondition(captureErrorCode(code) == "permission_denied") }
        for code in [-3817, -3821, -9999] { precondition(captureErrorCode(code) == "capture_stopped") }
        for code in [-3802, -3804, -3805, -3806, -3811, -3813, -3815] {
            precondition(captureErrorCode(code) == "capture_interrupted")
        }
        print("Native capture contract checks passed")
    }
}
