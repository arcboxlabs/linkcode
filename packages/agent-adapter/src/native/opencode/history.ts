import type {
  AgentHistoryEvent,
  AgentHistoryId,
  AgentHistorySession,
  ToolCall,
  ToolCallContent,
  ToolCallStatus,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import type { Message, Part, Session } from '@opencode-ai/sdk/v2';
import { asHistoryId, asMessageId, compactRecord, textHistoryEvent } from '../../history-util';
import { locationsFromToolInput, toolKindFromName } from '../../util';

type ToolPart = Extract<Part, { type: 'tool' }>;
type ToolPartState = ToolPart['state'];

/** One `session.messages` row: the message plus its final part list. */
export interface OpencodeMessageWithParts {
  info: Message;
  parts: Part[];
}

/** Map OpenCode's tool part state to our ToolCallStatus (running → in_progress, error → failed). */
export function mapOpencodeToolStatus(status: ToolPartState['status']): ToolCallStatus {
  switch (status) {
    case 'running':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'error':
      return 'failed';
    default:
      return 'pending';
  }
}

/** Surface a terminal tool state's output (completed) or error message (error) as tool-call content. */
export function toolStateContent(state: ToolPartState): ToolCallContent[] {
  if (state.status === 'completed' && state.output.length > 0) {
    return [{ type: 'content', content: textBlock(state.output) }];
  }
  if (state.status === 'error' && state.error.length > 0) {
    return [{ type: 'content', content: textBlock(state.error) }];
  }
  return [];
}

/** A tool part as the full ToolCall snapshot. Live stream (`emitTool`) and history replay share
 * this one mapping, keyed by the part id, so cold and live tool cards converge by id. */
export function toolCallFromPart(part: ToolPart): ToolCall {
  return {
    toolCallId: part.id,
    title: part.tool,
    kind: toolKindFromName(part.tool),
    status: mapOpencodeToolStatus(part.state.status),
    content: toolStateContent(part.state),
    rawInput: part.state.input,
    rawOutput: part.state.status === 'completed' ? part.state.output : undefined,
    locations: locationsFromToolInput(part.state.input),
  };
}

export function opencodeSessionToHistorySession(session: Session): AgentHistorySession {
  return {
    historyId: asHistoryId(session.id),
    kind: 'opencode',
    title: session.title || undefined,
    cwd: session.directory,
    model: session.model ? `${session.model.providerID}/${session.model.id}` : undefined,
    createdAt: session.time.created,
    updatedAt: session.time.updated,
    metadata: compactRecord({
      source: 'opencode-server',
      projectID: session.projectID,
      parentID: session.parentID,
      archivedAt: session.time.archived,
    }),
  };
}

/**
 * Drop reverted messages from a replay: OpenCode's revert marker means the `messageID` message and
 * everything after it was undone. A revert with `partID` is partial inside a message; the replay
 * has no per-part granularity, so everything is kept rather than over-cut (paseo's semantics).
 */
export function filterRevertedMessages(
  messages: OpencodeMessageWithParts[],
  revert: Session['revert'],
): OpencodeMessageWithParts[] {
  if (!revert?.messageID || revert.partID) return messages;
  const revertIndex = messages.findIndex((message) => message.info.id === revert.messageID);
  if (revertIndex < 0) return messages;
  return messages.slice(0, revertIndex);
}

/**
 * Replay stored messages as the event stream the live turn emitted: whole user messages, one
 * full-text chunk per assistant part (part ids are the live stream's message keys, so ids
 * converge), and full tool-call snapshots. `step-start`/`step-finish` bookkeeping doesn't replay.
 */
export function mapOpencodeHistoryEvents(
  historyId: AgentHistoryId,
  messages: OpencodeMessageWithParts[],
): AgentHistoryEvent[] {
  const events: AgentHistoryEvent[] = [];
  for (const { info, parts } of messages) {
    const ts = info.time.created;
    if (info.role === 'user') {
      const text = parts
        .reduce<string[]>((texts, part) => {
          if (part.type === 'text' && part.text.trim().length > 0) texts.push(part.text);
          return texts;
        }, [])
        .join('\n');
      // textHistoryEvent owns the empty-text-drops-the-event rule and the wire shape (shared with
      // the codex history path).
      const event = textHistoryEvent(historyId, 'user', info.id, text, ts);
      if (event) events.push(event);
      continue;
    }
    for (const part of parts) {
      switch (part.type) {
        case 'text': {
          const event = textHistoryEvent(historyId, 'assistant', part.id, part.text, ts);
          if (event) events.push(event);
          break;
        }
        case 'reasoning':
          if (part.text.trim().length === 0) break;
          events.push({
            historyId,
            itemId: part.id,
            ts,
            event: {
              type: 'agent-thought-chunk',
              messageId: asMessageId(part.id),
              content: textBlock(part.text),
            },
          });
          break;
        case 'tool':
          events.push({
            historyId,
            itemId: part.id,
            ts,
            event: { type: 'tool-call', toolCall: toolCallFromPart(part) },
          });
          break;
        default:
          break;
      }
    }
  }
  return events;
}
