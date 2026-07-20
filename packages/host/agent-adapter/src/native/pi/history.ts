import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
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

export type PiSdk = typeof import('@earendil-works/pi-coding-agent');

export async function listPiHistory(
  pi: PiSdk,
  opts?: AgentHistoryListOptions,
): Promise<AgentHistoryListResult> {
  const offset = cursorOffset(opts?.cursor);
  const limit = boundedLimit(opts?.limit, 50, 200);
  const infos = opts?.cwd
    ? await pi.SessionManager.list(opts.cwd)
    : await pi.SessionManager.listAll();
  const sessions = infos.map(toSession);
  return {
    sessions: sessions.slice(offset, offset + limit),
    cursor: cursorFromTotal(offset, sessions.length, limit),
  };
}

export async function readPiHistory(
  pi: PiSdk,
  opts: AgentHistoryReadOptions,
): Promise<AgentHistoryReadResult> {
  const file = await findPiSessionFile(opts.historyId);
  if (!file) throw new Error(`pi: history '${opts.historyId}' was not found`);
  const manager = pi.SessionManager.open(file);
  const entries = manager.getBranch();
  const events = mapPiHistoryEvents(opts.historyId, entries);
  const offset = cursorOffset(opts.cursor);
  const limit = boundedLimit(opts.limit, 1000, 1000);
  const header = manager.getHeader();
  return {
    session: {
      historyId: opts.historyId,
      kind: 'pi',
      title: manager.getSessionName() ?? firstUser(entries),
      cwd: header?.cwd || undefined,
      createdAt: header ? timestampMs(header.timestamp) : undefined,
      messageCount: entries.filter((entry) => entry.type === 'message').length,
      metadata: { path: file },
    },
    events: events.slice(offset, offset + limit),
    cursor: cursorFromTotal(offset, events.length, limit),
  };
}

export async function findPiSessionFile(
  id: string,
  root = piSessionsDir(),
): Promise<string | null> {
  let files: string[];
  try {
    files = await readdir(root, { recursive: true });
  } catch {
    return null;
  }
  const match = files.find((file) => {
    const name = basename(file);
    const separator = name.indexOf('_');
    return name.endsWith('.jsonl') && separator >= 0 && name.slice(separator + 1, -6) === id;
  });
  return match ? join(root, match) : null;
}

export function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');
}
export function piSessionsDir(): string {
  return join(piAgentDir(), 'sessions');
}

function toSession(info: SessionInfo): AgentHistorySession {
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

export function mapPiHistoryEvents(
  historyId: AgentHistoryId,
  entries: SessionEntry[],
): AgentHistoryEvent[] {
  const events: AgentHistoryEvent[] = [];
  const tools = new Map<string, ToolCall>();
  const tool = (ts: number | undefined, value: ToolCall) => {
    tools.set(value.toolCallId, value);
    events.push({
      historyId,
      itemId: value.toolCallId,
      ts,
      event: { type: 'tool-call', toolCall: value },
    });
  };
  for (const entry of entries) {
    const ts = timestampMs(entry.timestamp);
    if (entry.type === 'compaction') {
      events.push({
        historyId,
        itemId: entry.id,
        ts,
        event: {
          type: 'compaction',
          compactionId: entry.id,
          preTokens: entry.tokensBefore,
          summary: entry.summary,
        },
      });
      continue;
    }
    if (entry.type !== 'message' || !isRecord(entry.message)) continue;
    const message = entry.message;
    if (message.role === 'user') {
      const event = textHistoryEvent(historyId, 'user', entry.id, message.content, ts);
      if (event) events.push(event);
    } else if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isRecord(block)) continue;
        if (block.type === 'text') {
          const event = textHistoryEvent(historyId, 'assistant', entry.id, block.text, ts);
          if (event) events.push(event);
        } else if (
          block.type === 'thinking' &&
          typeof block.thinking === 'string' &&
          block.thinking.trim()
        ) {
          const id = asMessageId(`${entry.id}-thought`);
          events.push({
            historyId,
            itemId: id,
            ts,
            event: {
              type: 'agent-thought-chunk',
              messageId: id,
              content: textBlock(block.thinking),
            },
          });
        } else if (block.type === 'toolCall' && typeof block.id === 'string') {
          const name = typeof block.name === 'string' ? block.name : block.id;
          tool(ts, {
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
    } else if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
      const old = tools.get(message.toolCallId);
      const name = typeof message.toolName === 'string' ? message.toolName : message.toolCallId;
      tool(ts, {
        toolCallId: message.toolCallId,
        title: old?.title ?? name,
        kind: old?.kind ?? toolKindFromName(name),
        status: message.isError ? 'failed' : 'completed',
        content: old?.content ?? [],
        rawInput: old?.rawInput,
        locations: old?.locations,
        rawOutput: message.content,
      });
    } else if (message.role === 'bashExecution' && typeof message.command === 'string') {
      tool(ts, {
        toolCallId: `pi-bash-${entry.id}`,
        title: message.command,
        kind: 'execute',
        status:
          message.cancelled || (typeof message.exitCode === 'number' && message.exitCode !== 0)
            ? 'failed'
            : 'completed',
        content: [],
        rawOutput: compactRecord({ output: message.output, exitCode: message.exitCode }),
      });
    }
  }
  return events;
}

export function lastPiModelChange(entries: SessionEntry[]) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.type === 'model_change') return { provider: entry.provider, modelId: entry.modelId };
  }
  return null;
}
function firstUser(entries: SessionEntry[]): string | undefined {
  for (const entry of entries) {
    if (entry.type === 'message' && isRecord(entry.message) && entry.message.role === 'user') {
      const content = entry.message.content;
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .flatMap((part) =>
                  isRecord(part) && part.type === 'text' && typeof part.text === 'string'
                    ? [part.text]
                    : [],
                )
                .join('\n')
            : '';
      if (text.trim()) return preview(text);
    }
  }
  return undefined;
}
function preview(text: string): string | undefined {
  const value = text.trim().replaceAll(/\s+/g, ' ');
  return value ? value.slice(0, 160) : undefined;
}
