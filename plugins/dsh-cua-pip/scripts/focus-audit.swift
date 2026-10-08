import AppKit
import Foundation

// Read-only verification: activation notifications plus 50 Hz frontmost samples.
let args = Array(CommandLine.arguments.dropFirst())
guard args.count == 2, let target = Int32(args[0]), target > 0,
      let seconds = Double(args[1]), seconds >= 1, seconds <= 60 else {
    fputs("Usage: focus-audit <target-pid> <seconds:1...60>\n", stderr)
    exit(2)
}

let start = Date()
let initial = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
var samples = 0
var targetSamples = 0
var changes: [[String: Any]] = []
var last = initial
let center = NSWorkspace.shared.notificationCenter
let observer = center.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { note in
    guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
    changes.append([
        "source": "notification", "pid": app.processIdentifier,
        "elapsedMs": Date().timeIntervalSince(start) * 1000,
    ])
}
let timer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { _ in
    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
    samples += 1
    if pid == target { targetSamples += 1 }
    if pid != last {
        changes.append(["source": "sample", "pid": pid, "elapsedMs": Date().timeIntervalSince(start) * 1000])
        last = pid
    }
}
RunLoop.main.run(until: start.addingTimeInterval(seconds))
timer.invalidate()
center.removeObserver(observer)
let report: [String: Any] = [
    "initialFrontmostPid": initial,
    "finalFrontmostPid": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0,
    "targetPid": target, "targetFrontmostSamples": targetSamples,
    "samples": samples, "changes": changes,
]
let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
FileHandle.standardOutput.write(data + Data([10]))
