import ActivityKit
import Foundation

// Shape of the LinkCode "agent session" Live Activity. The JS side that starts /
// updates / ends the activity (a follow-up native bridge) must encode the same
// fields — keep this in sync with that bridge.
struct AgentSessionAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    // Human-readable run status, e.g. "Running", "Waiting for approval", "Done".
    var status: String
    // Optional one-line detail, e.g. the current tool or elapsed summary.
    var detail: String?
  }

  // Static for the activity's lifetime.
  var sessionTitle: String
  var agentName: String
}
