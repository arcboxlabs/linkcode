import type { ContentBlock } from '@linkcode/schema';
import type { ConversationItem } from './types';

/** Plain-text projection of content blocks (non-text blocks are skipped). */
export function contentBlocksText(blocks: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text) parts.push(block.text);
  }
  return parts.join('\n');
}

/** The turn's copyable reply: every assistant message's text, in order. */
export function assistantTurnText(items: readonly ConversationItem[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (item.kind !== 'message' || item.role !== 'assistant') continue;
    const text = contentBlocksText(item.blocks);
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

/** The model that served the turn: its last assistant message's stamp. */
export function turnModel(items: readonly ConversationItem[]): string | undefined {
  let model: string | undefined;
  for (const item of items) {
    if (item.kind === 'message' && item.role === 'assistant' && item.model) model = item.model;
  }
  return model;
}

/** Best-known time of the latest-stamped item — the turn's approximate end time. */
export function latestReceivedAt(items: readonly ConversationItem[]): number | undefined {
  let latest: number | undefined;
  for (const item of items) {
    if (item.receivedAt !== undefined && (latest === undefined || item.receivedAt > latest)) {
      latest = item.receivedAt;
    }
  }
  return latest;
}
