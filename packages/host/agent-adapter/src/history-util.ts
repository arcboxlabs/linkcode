import type { AgentHistoryEvent, AgentHistoryId, MessageId, Timestamp } from '@linkcode/schema';
import { MAX_ATTACHMENT_TOTAL_BASE64_LENGTH, textBlock } from '@linkcode/schema';
import { clamp } from 'foxts/clamp';
import { nextMessageId } from './adapter';

export function asHistoryId(value: string): AgentHistoryId {
  return value as AgentHistoryId;
}

export function asMessageId(value: string): MessageId {
  return value as MessageId;
}

export function cursorOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const value = Number.parseInt(cursor, 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function boundedLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  return clamp(Math.trunc(value), 1, max);
}

export function cursorFromFetched(
  offset: number,
  fetchedCount: number,
  limit: number,
): string | undefined {
  return fetchedCount > limit ? String(offset + limit) : undefined;
}

export function cursorFromTotal(
  offset: number,
  totalCount: number,
  limit: number,
): string | undefined {
  return offset + limit < totalCount ? String(offset + limit) : undefined;
}

/** Base64 payload one replayed event embeds — user messages are where attachments ride. */
function eventAttachmentLength(event: AgentHistoryEvent): number {
  if (event.event.type !== 'user-message') return 0;
  let total = 0;
  for (const block of event.event.content) {
    if (block.type === 'image' || block.type === 'audio') total += block.data.length;
    else if (block.type === 'resource' && 'blob' in block.resource) {
      total += block.resource.blob.length;
    }
  }
  return total;
}

/** Page slice bounded by event count AND aggregate embedded-attachment payload. One
 * `history.read.result` travels as a single logical transport message, and the tunnel silently
 * drops any message its reassembly buffer cannot hold — so image-heavy transcripts must fan
 * across cursor pages instead of concentrating attachments into one reply. The budget is
 * `MAX_ATTACHMENT_TOTAL_BASE64_LENGTH` (what transports already size a maximal prompt's frame
 * for); a page's first event always ships, since per-prompt caps keep any single event within
 * that budget on its own. */
export function sliceHistoryEventPage(
  events: readonly AgentHistoryEvent[],
  offset: number,
  limit: number,
): { events: AgentHistoryEvent[]; cursor: string | undefined } {
  const page: AgentHistoryEvent[] = [];
  let payloadLength = 0;
  for (let index = offset; index < events.length && page.length < limit; index += 1) {
    const attachmentLength = eventAttachmentLength(events[index]);
    if (page.length > 0 && payloadLength + attachmentLength > MAX_ATTACHMENT_TOTAL_BASE64_LENGTH) {
      break;
    }
    payloadLength += attachmentLength;
    page.push(events[index]);
  }
  const next = offset + page.length;
  return { events: page, cursor: next < events.length ? String(next) : undefined };
}

export function textHistoryEvent(
  historyId: AgentHistoryId,
  role: 'user' | 'assistant',
  itemId: string | undefined,
  value: unknown,
  ts?: Timestamp,
  parentToolCallId?: string,
): AgentHistoryEvent | undefined {
  const text = textFromUnknown(value);
  if (text.trim().length === 0) return undefined;
  // agent-message-chunk now requires a messageId (the grouping authority); guarantee one.
  const messageId = itemId ? asMessageId(itemId) : nextMessageId();
  return {
    historyId,
    itemId,
    ts,
    event:
      role === 'user'
        ? { type: 'user-message', messageId, content: [textBlock(text)] }
        : { type: 'agent-message-chunk', messageId, parentToolCallId, content: textBlock(text) },
  };
}

/** The thought counterpart of `textHistoryEvent` (same empty-drop rule): replayed reasoning must
 * emit as `agent-thought-chunk`, never fold into message text — the wire keeps them distinct. */
export function thoughtHistoryEvent(
  historyId: AgentHistoryId,
  messageId: string,
  text: string,
  ts?: Timestamp,
  parentToolCallId?: string,
): AgentHistoryEvent | undefined {
  if (text.trim().length === 0) return undefined;
  return {
    historyId,
    itemId: messageId,
    ts,
    event: {
      type: 'agent-thought-chunk',
      messageId: asMessageId(messageId),
      parentToolCallId,
      content: textBlock(text),
    },
  };
}

export function textFromUnknown(value: unknown): string {
  let current = value;
  while (true) {
    if (typeof current === 'string') return current;
    if (Array.isArray(current)) {
      return current
        .reduce<string[]>((texts, item) => {
          const text = textFromUnknown(item);
          if (text.length > 0) texts.push(text);
          return texts;
        }, [])
        .join('\n');
    }
    if (!isRecord(current)) return '';

    const text = current.text;
    if (typeof text === 'string') return text;

    const content = current.content;
    if (content !== undefined) {
      current = content;
      continue;
    }

    const message = current.message;
    if (message !== undefined) {
      current = message;
      continue;
    }

    const parts = current.parts;
    if (parts !== undefined) {
      current = parts;
      continue;
    }

    return '';
  }
}

export function timestampMs(value: unknown): Timestamp | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

export function compactRecord(
  values: Record<string, unknown | undefined>,
): Record<string, unknown> | undefined {
  const entries = Object.entries(values).filter((entry): entry is [string, unknown] => {
    const value = entry[1];
    return value !== undefined && value !== null && value !== '';
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function firstText(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
