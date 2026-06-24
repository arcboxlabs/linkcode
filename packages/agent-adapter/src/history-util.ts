import type { AgentHistoryEvent, AgentHistoryId, MessageId, Timestamp } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';

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
  return Math.min(max, Math.max(1, Math.trunc(value)));
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

export function textHistoryEvent(
  historyId: AgentHistoryId,
  role: 'user' | 'assistant',
  itemId: string | undefined,
  value: unknown,
  ts?: Timestamp,
): AgentHistoryEvent | undefined {
  const text = textFromUnknown(value);
  if (text.trim().length === 0) return undefined;
  const messageId = itemId ? asMessageId(itemId) : undefined;
  return {
    historyId,
    itemId,
    ts,
    event: {
      type: role === 'user' ? 'user-message-chunk' : 'agent-message-chunk',
      messageId,
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

    const thinking = current.thinking;
    if (typeof thinking === 'string') return thinking;

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
