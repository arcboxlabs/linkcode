import ActivityKit
import SwiftUI
import WidgetKit

struct AgentSessionLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AgentSessionAttributes.self) { context in
      // Lock screen / notification banner presentation.
      VStack(alignment: .leading, spacing: 4) {
        Text(context.attributes.sessionTitle)
          .font(.headline)
          .lineLimit(1)
        HStack {
          Text(context.attributes.agentName)
            .font(.subheadline)
            .foregroundStyle(.secondary)
          Spacer()
          Text(context.state.status)
            .font(.subheadline.weight(.medium))
        }
        if let detail = context.state.detail {
          Text(detail)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      .padding()
      .activityBackgroundTint(Color.black.opacity(0.6))
      .activitySystemActionForegroundColor(Color.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "sparkles")
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.state.status)
            .font(.caption)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.attributes.sessionTitle)
            .font(.caption)
            .lineLimit(1)
        }
      } compactLeading: {
        Image(systemName: "sparkles")
      } compactTrailing: {
        Text(context.state.status)
          .font(.caption2)
          .lineLimit(1)
      } minimal: {
        Image(systemName: "sparkles")
      }
    }
  }
}
