import AppKit

final class Fixture: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private let counter = NSTextField(labelWithString: "Count: 0")
    private var count = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(
            contentRect: NSRect(x: 120, y: 160, width: 480, height: 240),
            styleMask: [.titled, .closable], backing: .buffered, defer: false
        )
        window.title = "DSH PiP Input Fixture"
        window.isReleasedWhenClosed = false
        let button = NSButton(title: "Fixture Increment", target: self, action: #selector(increment))
        button.frame = NSRect(x: 40, y: 120, width: 180, height: 40)
        button.bezelStyle = .rounded
        counter.frame = NSRect(x: 40, y: 60, width: 300, height: 40)
        counter.font = NSFont.systemFont(ofSize: 24)
        window.contentView?.addSubview(button)
        window.contentView?.addSubview(counter)
        // The fixture owns no user data and never requests key/front status.
        window.orderBack(nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            self.emit(["pid": ProcessInfo.processInfo.processIdentifier, "windowId": self.window.windowNumber])
        }
        Timer.scheduledTimer(withTimeInterval: 60, repeats: false) { _ in NSApp.terminate(nil) }
    }

    @objc private func increment() {
        count += 1
        counter.stringValue = "Count: \(count)"
        emit(["event": "increment", "count": count])
    }

    private func emit(_ value: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: value) {
            FileHandle.standardOutput.write(data + Data([10]))
        }
    }
}

@main
enum Main {
    static func main() {
        let app = NSApplication.shared
        let fixture = Fixture()
        app.setActivationPolicy(.accessory)
        app.delegate = fixture
        DispatchQueue.global().async {
            _ = readLine()
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
        app.run()
    }
}
