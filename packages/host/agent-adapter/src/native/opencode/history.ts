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
import { encodeHistoryBranchCursor } from '../../history-branch';
import {
  asHistoryId,
  compactRecord,
  textHistoryEvent,
  thoughtHistoryEvent,
} from '../../history-util';
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

const OPENCODE_TOOL_NAME_SANITIZE_RE = /[^\w-]/g;

/** opencode's model-facing MCP tool name is `sanitize(server)_sanitize(tool)` — a flat single-
 * underscore join with every char outside [A-Za-z0-9_-] mapped to `_`, and no server field on
 * the part (anomalyco/opencode 1.18.15 `McpCatalog.toolName`). The join is only reversible
 * against the configured server names; the longest sanitized prefix wins. The flat namespace is
 * shared with underscore builtins (`apply_patch`) and custom `<file>_<export>` tools, so a
 * server named like such a prefix retitles them — inherent to the join, cosmetic only. */
export function opencodeMcpToolName(
  tool: string,
  mcpServers: readonly string[],
): { server: string; tool: string } | undefined {
  let match: { server: string; tool: string } | undefined;
  let matchedLength = 0;
  for (let i = 0, len = mcpServers.length; i < len; i++) {
    const server = mcpServers[i];
    const prefix = `${server.replaceAll(OPENCODE_TOOL_NAME_SANITIZE_RE, '_')}_`;
    if (prefix.length <= matchedLength || tool.length <= prefix.length) continue;
    if (tool.startsWith(prefix)) {
      match = { server, tool: tool.slice(prefix.length) };
      matchedLength = prefix.length;
    }
  }
  return match;
}

/** The shared cross-agent `mcp__<server>__<tool>` title slug for a flat opencode tool name,
 * when it resolves to a known server. */
export function opencodeMcpTitle(tool: string, mcpServers: readonly string[]): string | undefined {
  const mcp = opencodeMcpToolName(tool, mcpServers);
  // The shared slug splits on the first `__`; keep the provider's verbatim title when ambiguous.
  return mcp && !mcp.server.includes('__') ? `mcp__${mcp.server}__${mcp.tool}` : undefined;
}

/** A tool part as the full ToolCall snapshot. Live stream (`emitTool`) and history replay share
 * this one mapping, keyed by the part id, so cold and live tool cards converge by id. A tool
 * from a known MCP server takes the shared `mcp__<server>__<tool>` title slug, like claude-code
 * and codex, so server context, brand glyphs, and integration groups light up downstream. */
export function toolCallFromPart(part: ToolPart, mcpServers: readonly string[] = []): ToolCall {
  const title = opencodeMcpTitle(part.tool, mcpServers) ?? part.tool;
  return {
    toolCallId: part.id,
    title,
    kind: toolKindFromName(title),
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
  mcpServers: readonly string[] = [],
): AgentHistoryEvent[] {
  const events: AgentHistoryEvent[] = [];
  for (let i = 0, len = messages.length; i < len; i++) {
    const { info, parts } = messages[i];
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
      if (event?.event.type === 'user-message') {
        events.push({
          ...event,
          event: {
            ...event.event,
            branchCursor: encodeHistoryBranchCursor('opencode', historyId, info.id),
          },
        });
      }
      continue;
    }
    for (const part of parts) {
      switch (part.type) {
        case 'text': {
          const event = textHistoryEvent(historyId, 'assistant', part.id, part.text, ts);
          if (event) events.push(event);
          break;
        }
        case 'reasoning': {
          const event = thoughtHistoryEvent(historyId, part.id, part.text, ts);
          if (event) events.push(event);
          break;
        }
        case 'tool':
          events.push({
            historyId,
            itemId: part.id,
            ts,
            event: { type: 'tool-call', toolCall: toolCallFromPart(part, mcpServers) },
          });
          break;
        default:
          break;
      }
    }
  }
  return events;
}
