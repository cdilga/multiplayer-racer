import SwiftUI

// Empty host app. XCUITest needs a target application to hang the UI test bundle on;
// the lane drives Mobile Safari, never this app.
@main
struct F08HostApp: App {
    var body: some Scene { WindowGroup { Text("jj-f08 host") } }
}
