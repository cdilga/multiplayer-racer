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

// ---------------------------------------------------------------------------------------------------------------
// Command mode (drive.mjs): the Node lane queues commands on the collector and this test executes them with real
// XCUITest touches in Mobile Safari, until it is told to stop. Coordinates are CSS px of the page; the page's top-left
// is the web view's top-left. Two simultaneous fingers use XCTest's own event synthesizer (XCPointerEventPath), the
// same machinery XCUIElement.pinch uses, because the public API has no two-finger-at-different-points gesture.
extension F08UITests {
    func http(_ path: String, post: [String: Any]? = nil, timeout: TimeInterval = 15) -> Data? {
        var req = URLRequest(url: URL(string: "\(collector)\(path)")!)
        req.timeoutInterval = timeout
        if let post = post { req.httpMethod = "POST"; req.httpBody = try? JSONSerialization.data(withJSONObject: post) }
        var out: Data?
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { d, r, _ in if (r as? HTTPURLResponse)?.statusCode == 200 { out = d }; sem.signal() }.resume()
        sem.wait()
        return out
    }

    typealias InitPt = @convention(c) (AnyObject, Selector, CGPoint, Double) -> AnyObject
    typealias MovePt = @convention(c) (AnyObject, Selector, CGPoint, Double) -> Void
    typealias Lift = @convention(c) (AnyObject, Selector, Double) -> Void
    typealias RecInit = @convention(c) (AnyObject, Selector, NSString, Int) -> AnyObject
    typealias AddPath = @convention(c) (AnyObject, Selector, AnyObject) -> Void
    typealias Synth = @convention(c) (AnyObject, Selector, AnyObject, @escaping @convention(block) (Bool, Error?) -> Void) -> Void

    func imp<T>(_ cls: AnyClass, _ name: String, as: T.Type, instance: Bool = true) -> T? {
        let sel = NSSelectorFromString(name)
        guard let m = instance ? class_getInstanceMethod(cls, sel) : class_getClassMethod(cls, sel) else { return nil }
        return unsafeBitCast(method_getImplementation(m), to: T.self)
    }

    /// Fingers: (start, end) screen points in points. Moves over `ms` in steps, holds, lifts. Returns an error string or nil.
    func touches(_ fingers: [(CGPoint, CGPoint)], ms: Double) -> String? {
        guard let pathCls = NSClassFromString("XCPointerEventPath"), let recCls = NSClassFromString("XCSynthesizedEventRecord") else { return "no XCPointerEventPath/XCSynthesizedEventRecord" }
        guard let initPt = imp(pathCls, "initForTouchAtPoint:offset:", as: InitPt.self), let move = imp(pathCls, "moveToPoint:atOffset:", as: MovePt.self),
              let lift = imp(pathCls, "liftUpAtOffset:", as: Lift.self), let recInit = imp(recCls, "initWithName:interfaceOrientation:", as: RecInit.self),
              let add = imp(recCls, "addPointerEventPath:", as: AddPath.self) else { return "XCTest private touch API selectors missing" }
        let alloc = NSSelectorFromString("alloc")
        let rec = recInit((recCls as AnyObject).perform(alloc).takeUnretainedValue(), NSSelectorFromString("initWithName:interfaceOrientation:"), "f08" as NSString, 1 /* portrait: the simulator stays upright; touch points are in that frame */)
        let secs = ms / 1000
        for (from, to) in fingers {
            let p = initPt((pathCls as AnyObject).perform(alloc).takeUnretainedValue(), NSSelectorFromString("initForTouchAtPoint:offset:"), from, 0)
            if from != to { // a tap is a touch-down and a lift only
                let steps = 8
                for i in 1...steps {
                    let f = Double(i) / Double(steps)
                    move(p, NSSelectorFromString("moveToPoint:atOffset:"), CGPoint(x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f), 0.05 + min(0.4, secs / 2) * f)
                }
                move(p, NSSelectorFromString("moveToPoint:atOffset:"), to, max(0.6, secs - 0.05))
            }
            lift(p, NSSelectorFromString("liftUpAtOffset:"), secs)
            add(rec, NSSelectorFromString("addPointerEventPath:"), p)
        }
        guard let synthObj = XCUIDevice.shared.perform(NSSelectorFromString("eventSynthesizer"))?.takeUnretainedValue(),
              let synth = imp(type(of: synthObj), "synthesizeEvent:completion:", as: Synth.self) else { return "no eventSynthesizer" }
        var err: String? = "timeout"
        let sem = DispatchSemaphore(value: 0)
        synth(synthObj, NSSelectorFromString("synthesizeEvent:completion:"), rec) { ok, e in err = ok ? nil : "synthesize failed: \(String(describing: e))"; sem.signal() }
        if sem.wait(timeout: .now() + ms / 1000 + 20) == .timedOut { return "synthesize timed out" }
        return err
    }

    func testDrive() throws {
        safari.activate()
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 30), "Safari not foreground")
        let web = safari.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 30), "no web view")
        _ = http("/__lane/cmd/ack", post: ["id": 0, "ready": true])
        var idle = 0
        while idle < 400 { // ~ 55 min of 8 s polls is far more than a run needs
            guard let d = http("/__lane/cmd/next", timeout: 20), let c = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let id = c["id"] as? Int, let op = c["op"] as? String else { idle += 1; continue }
            idle = 0
            var res: [String: Any] = ["id": id, "ok": true]
            switch op {
            case "tap", "hold":
                let o = web.frame.origin
                let pt = { (m: [String: Any]) -> CGPoint in CGPoint(x: o.x + CGFloat((m["x"] as? NSNumber)?.doubleValue ?? 0), y: o.y + CGFloat((m["y"] as? NSNumber)?.doubleValue ?? 0)) }
                var fingers: [(CGPoint, CGPoint)] = []
                if op == "tap", let m = c as? [String: Any] { let p = pt(m); fingers = [(p, p)] }
                else if let fs = c["fingers"] as? [[String: Any]] { fingers = fs.map { (pt($0["from"] as! [String: Any]), pt($0["to"] as! [String: Any])) } }
                if let e = touches(fingers, ms: (c["ms"] as? NSNumber)?.doubleValue ?? 120) { res["ok"] = false; res["error"] = e }
                res["webFrame"] = "\(web.frame)"
            case "home": XCUIDevice.shared.press(.home)
            case "activate": safari.activate(); res["ok"] = safari.wait(for: .runningForeground, timeout: 20)
            case "orientation": break
            case "done": _ = http("/__lane/cmd/ack", post: res); return
            default: res["ok"] = false; res["error"] = "unknown op \(op)"
            }
            _ = http("/__lane/cmd/ack", post: res)
        }
    }
}

extension XCUIElement {
    func tapIfExists() { if exists && isHittable { tap() } }
}
