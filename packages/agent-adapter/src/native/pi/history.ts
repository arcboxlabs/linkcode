import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SessionEntry, SessionInfo } from '@earendil-works/pi-coding-agent';
import type {
  AgentHistoryEvent,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistorySession,
  ToolCall,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import {
  asHistoryId,
  asMessageId,
  boundedLimit,
  compactRecord,
  cursorFromTotal,
  cursorOffset,
  isRecord,
  textHistoryEvent,
  timestampMs,
} from '../../history-util';
import { locationsFromToolInput, toolKindFromName } from '../../util';

/**
 * pi history — direct reads of the on-disk session store (JSONL files under
 * `~/.pi/agent/sessions/<cwd-slug>/`), independent of any live session, via the SDK's own
 * `SessionManager` statics. Like codex, everything here must work on a never-started adapter
 * instance: no `this`, no live process, plain module functions over the SDK module object.
 */

export type PiSdk = typeof import('@earendil-works/pi-coding-agent');

/** Plain import, not `loadSdk`: history calls run on never-started adapter instances where the
 * sdk-unavailable error event has no listeners — the rejection reaching HistoryService is the
 * whole story. */
export function importPiSdk(): Promise<PiSdk> {
  return import('@earendil-works/pi-coding-agent');
}

export async function listPiHistory(
  pi: PiSdk,
  opts?: AgentHistoryListOptions,
): Promise<AgentHistoryListResult> {
  const offset = cursorOffset(opts?.cursor);
  const limit = boundedLimit(opts?.limit, 50, 200);
  // list(cwd) scans only that cwd's session subdirectory; listAll walks every one. Both fully
  // parse each transcript to build SessionInfo (SDK behavior) — measured a few ms for tens of
  // sessions; revisit with a head/tail partial scan only if it ever shows up in profiles.
  const infos = opts?.cwd
    ? await pi.SessionManager.list(opts.cwd)
    : await pi.SessionManager.listAll();
  const sessions = infos.map((info) => piSessionInfoToHistorySession(info));
  return {
    sessions: sessions.slice(offset, offset + limit),
    cursor: cursorFromTotal(offset, sessions.length, limit),
  };
}

export async function readPiHistory(
  pi: PiSdk,
  opts: AgentHistoryReadOptions,
): Promise<AgentHistoryReadResult> {
  const offset = cursorOffset(opts.cursor);
  const limit = boundedLimit(opts.limit, 1000, 1000);
  const file = await findPiSessionFile(opts.historyId);
  if (!file) throw new Error(`pi: history '${opts.historyId}' was not found`);

  const manager = pi.SessionManager.open(file);
  // pi sessions are trees (branch/fork/rewind keep every node); buildContextEntries follows the
  // current leaf path and is compaction-aware, which is exactly the linear transcript we replay.
  const entries = pi.buildContextEntries(manager.getEntries(), manager.getLeafId());
  const events = mapPiHistoryEvents(opts.historyId, entries);
  const header = manager.getHeader();

  const session: AgentHistorySession = {
    historyId: opts.historyId,
    kind: 'pi',
    title: manager.getSessionName() ?? firstUserPreview(entries),
    cwd: header?.cwd || undefined,
    createdAt: header ? timestampMs(header.timestamp) : undefined,
    messageCount: entries.filter((entry) => entry.type === 'message').length,
    metadata: { path: file },
  };
  return {
    session,
    events: events.slice(offset, offset + limit),
    cursor: cursorFromTotal(offset, events.length, limit),
  };
}

/**
 * Resolve a session id to its transcript file without parsing anything: files are named
 * `<timestamp>_<sessionId>.jsonl` under per-cwd subdirectories of the sessions root. The root
 * mirrors the SDK's unexported `getSessionsDir()`: `$PI_CODING_AGENT_DIR` (or `~/.pi/agent`)
 * + `/sessions`.
 */
export async function findPiSessionFile(
  sessionId: string,
  sessionsDir = piSessionsDir(),
): Promise<string | null> {
  const suffix = `_${sessionId}.jsonl`;
  let files: string[];
  try {
    files = await readdir(sessionsDir, { recursive: true });
  } catch {
    return null;
  }
  const match = files.find((file) => file.endsWith(suffix));
  return match ? join(sessionsDir, match) : null;
}

export function piSessionsDir(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');
  return join(agentDir, 'sessions');
}

function piSessionInfoToHistorySession(info: SessionInfo): AgentHistorySession {
  return {
    historyId: asHistoryId(info.id),
    kind: 'pi',
    title: info.name ?? preview(info.firstMessage),
    cwd: info.cwd || undefined,
    createdAt: timestampMs(info.created.getTime()),
    updatedAt: timestampMs(info.modified.getTime()),
    messageCount: info.messageCount,
    metadata: compactRecord({ path: info.path, parentSessionPath: info.parentSessionPath }),
  };
}

/**
 * Replay the context entries as normalized history events. Tool announces (assistant `toolCall`
 * blocks) and settles (`toolResult` messages) are correlated by the provider tool-call id — the
 * SAME ids the live stream's `tool_execution_*` events carry, so live and cold tool cards converge
 * by id. Text/thinking cannot converge (live segments mint fresh ids before entries exist), which
 * matches the codex-history precedent.
 */
export function mapPiHistoryEvents(
  historyId: AgentHistoryId,
  entries: SessionEntry[],
): AgentHistoryEvent[] {
  const events: AgentHistoryEvent[] = [];
  const announced = new Map<string, ToolCall>();
  const recordTool = (ts: number | undefined, toolCall: ToolCall) => {
    announced.set(toolCall.toolCallId, toolCall);
    events.push({
      historyId,
      itemId: toolCall.toolCallId,
      ts,
      event: { type: 'tool-call', toolCall },
    });
  };

  for (const entry of entries) {
    // model_change / thinking_level_change / compaction / labels have no timeline representation;
    // custom extension entries are state, not conversation.
    if (entry.type !== 'message') continue;
    const ts = timestampMs(entry.timestamp);
    const message: unknown = entry.message;
    if (!isRecord(message)) continue;

    switch (message.role) {
      case 'user': {
        const event = textHistoryEvent(historyId, 'user', entry.id, message.content, ts);
        if (event) events.push(event);
        break;
      }
      case 'assistant': {
        if (!Array.isArray(message.content)) break;
        for (const block of message.content) {
          if (!isRecord(block)) continue;
          if (block.type === 'text') {
            const event = textHistoryEvent(historyId, 'assistant', entry.id, block.text, ts);
            if (event) events.push(event);
          } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
            if (block.thinking.trim().length === 0) continue;
            const thoughtId = `${entry.id}-thought`;
            events.push({
              historyId,
              itemId: thoughtId,
              ts,
              event: {
                type: 'agent-thought-chunk',
                messageId: asMessageId(thoughtId),
                content: textBlock(block.thinking),
              },
            });
          } else if (block.type === 'toolCall' && typeof block.id === 'string') {
            const name = typeof block.name === 'string' ? block.name : block.id;
            recordTool(ts, {
              toolCallId: block.id,
              title: name,
              kind: toolKindFromName(name),
              status: 'in_progress',
              content: [],
              rawInput: block.arguments,
              locations: locationsFromToolInput(block.arguments),
            });
          }
        }
        break;
      }
      case 'toolResult': {
        if (typeof message.toolCallId !== 'string') break;
        const existing = announced.get(message.toolCallId);
        const name = typeof message.toolName === 'string' ? message.toolName : message.toolCallId;
        recordTool(ts, {
          toolCallId: message.toolCallId,
          title: existing?.title ?? name,
          kind: existing?.kind ?? toolKindFromName(name),
          status: message.isError === true ? 'failed' : 'completed',
          content: existing?.content ?? [],
          rawInput: existing?.rawInput,
          locations: existing?.locations,
          rawOutput: message.content,
        });
        break;
      }
      case 'bashExecution': {
        // A user-initiated `!` shell run, recorded by pi as its own message role — replay as an
        // already-settled execute card (there is no announce/settle pair to correlate).
        if (typeof message.command !== 'string') break;
        recordTool(ts, {
          toolCallId: `pi-bash-${entry.id}`,
          title: message.command,
          kind: 'execute',
          status: message.cancelled === true ? 'failed' : 'completed',
          content: [],
          rawOutput: compactRecord({ output: message.output, exitCode: message.exitCode }),
        });
        break;
      }
      default:
        break;
    }
  }
  return events;
}

/** The model the session was last switched to on its context path, for resume credential
 * targeting — runtime key injection is provider-scoped and happens before the SDK's own restore. */
export function lastPiModelChange(
  entries: SessionEntry[],
): { provider: string; modelId: string } | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === 'model_change') return { provider: entry.provider, modelId: entry.modelId };
  }
  return null;
}

function firstUserPreview(entries: SessionEntry[]): string | undefined {
  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    const message: unknown = entry.message;
    if (!isRecord(message) || message.role !== 'user') continue;
    const text = userText(message.content);
    if (text) return preview(text);
  }
  return undefined;
}

function userText(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  const text = parts.join('\n').trim();
  return text || null;
}

function preview(text: string): string | undefined {
  const normalized = text.trim().replaceAll(/\s+/g, ' ');
  if (!normalized) return undefined;
  return normalized.length > 160 ? normalized.slice(0, 160) : normalized;
}
