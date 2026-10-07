import XCTest

// P1-F08 iOS Simulator driver. Drives Mobile Safari with real XCUITest touches; the page under test
// (served by the lane with the probe injected) reports what it received, and the Node lane asserts on
// that. The test only does the gestures and waits on the lane's collector for the page to settle.
//
// Env (TEST_RUNNER_ prefix on xcodebuild): JJ_COLLECTOR = http://localhost:<port>, JJ_CODE = code to type.
final class F08UITests: XCTestCase {
    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    var collector: String { ProcessInfo.processInfo.environment["JJ_COLLECTOR"] ?? "" }
    var code: String { ProcessInfo.processInfo.environment["JJ_CODE"] ?? "ABCD" }

    override func setUp() { continueAfterFailure = false }

    /// Long-polls the collector until an event of `kind` (optionally with `tag`) exists.
    func waitFor(_ kind: String, timeout: TimeInterval = 30) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let url = URL(string: "\(collector)/__lane/has?kind=\(kind)")!
            var out = "0"
            let sem = DispatchSemaphore(value: 0)
            URLSession.shared.dataTask(with: url) { d, _, _ in
                if let d = d, let s = String(data: d, encoding: .utf8) { out = s }
                sem.signal()
            }.resume()
            sem.wait()
            if out == "1" { return true }
            Thread.sleep(forTimeInterval: 0.5)
        }
        return false
    }

    func testLane() throws {
        safari.activate()  // the lane already opened the page with `simctl openurl`
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20), "Safari not foreground")
        XCTAssertTrue(waitFor("load"), "probe never reported load")
        let web = safari.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 20), "no web view")

        // AC1: type into the join page's code field.
        let field = web.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 20), "no code field")
        field.tap()
        field.typeText(code)
        XCTAssertTrue(waitFor("typed"), "page never reported the typed code")
        safari.keyboards.buttons["Return"].firstMatch.tapIfExists()
        safari.keyboards.buttons["Done"].firstMatch.tapIfExists()
        // Dismiss the keyboard by tapping empty page space (also a single-finger touch for the probe).
        web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.97)).tap()

        // AC2: two independent fingers (pinch) on the page body.
        web.pinch(withScale: 2.0, velocity: 1.0)
        XCTAssertTrue(waitFor("touch2"), "page never saw two simultaneous touches")

        // AC3: background (Home) then foreground.
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(waitFor("hidden", timeout: 30), "page never reported hidden")
        Thread.sleep(forTimeInterval: 1.0)
        safari.activate()
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20))
        XCTAssertTrue(waitFor("visible-after-hidden", timeout: 45), "page never reported visible again")
    }
}

extension XCUIElement {
    func tapIfExists() { if exists && isHittable { tap() } }
}
