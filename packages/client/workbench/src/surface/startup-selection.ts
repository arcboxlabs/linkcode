import type { SequencedAgentEvent } from '@linkcode/client-core';
import type { EffortLevel } from '@linkcode/schema';
import type { NewSessionSelection } from './new-session-defaults-store';

interface RequestedStartupSelection {
  model?: string | null;
  effort?: EffortLevel | null;
}

/**
 * Turns startup controls into preferences only after the provider reflects them. Session start
 * buffers adapter events before its acknowledgement, so the latest value on each requested axis
 * is authoritative here. A missing/corrected reflection or an explicit null reset clears a stale
 * remembered override.
 */
export function reflectedStartupSelection(
  requested: RequestedStartupSelection,
  events: readonly SequencedAgentEvent[],
): NewSessionSelection {
  let reflectedModel: string | undefined;
  let reflectedEffort: EffortLevel | undefined;
  for (const { event } of events) {
    if (event.type === 'model-update') reflectedModel = event.model;
    else if (event.type === 'effort-update') reflectedEffort = event.effort;
  }

  return {
    ...(requested.model !== undefined && {
      model:
        requested.model === null
          ? null
          : reflectedModel === requested.model
            ? requested.model
            : null,
    }),
    ...(requested.effort !== undefined && {
      effort:
        requested.effort === null
          ? null
          : reflectedEffort === requested.effort
            ? requested.effort
            : null,
    }),
  };
}

/**
 * Promotes axes that were unconfirmed at session start only after a later exact reflection. A
 * mismatch stays absent rather than becoming another clear patch, because the user may have made a
 * newer live selection while the first turn was running.
 */
export function newlyConfirmedStartupSelection(
  requested: RequestedStartupSelection,
  initial: NewSessionSelection,
  events: readonly SequencedAgentEvent[],
): NewSessionSelection {
  const reflected = reflectedStartupSelection(requested, events);
  return {
    ...(initial.model === null &&
      requested.model != null &&
      reflected.model === requested.model && { model: requested.model }),
    ...(initial.effort === null &&
      requested.effort != null &&
      reflected.effort === requested.effort && { effort: requested.effort }),
  };
}
