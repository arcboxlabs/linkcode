import type { ContentBlock, ToolCallContent } from '@linkcode/schema';
import { simpleStringHash } from 'foxts/simple-string-hash';

type AdapterContent = ContentBlock | ToolCallContent;

/**
 * Keys for a message's block list, where position — not content — is the identity: the builder's
 * appendBlock only pushes a new block or extends the LAST one, so blocks never reorder, drop, or
 * change type in place, and the streaming tail mutates every token. Content-derived keys
 * ({@link contentDerivedEntries}) would remount that tail per token and break smooth streaming;
 * a positional key keeps it mounted for the whole stream.
 */
export function positionalBlockEntries(
  blocks: readonly ContentBlock[],
): Array<{ block: ContentBlock; key: string }> {
  return blocks.map((block, index) => ({ block, key: `${index}:${block.type}` }));
}

/** Adapter content snapshots have no block IDs, so derive keys from their wire values.
 * Duplicate values are interchangeable; an occurrence suffix only prevents sibling collisions. */
export function contentDerivedEntries<T extends AdapterContent>(
  items: readonly T[],
): Array<{ item: T; key: string }> {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const identity = simpleStringHash(JSON.stringify(item));
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return {
      item,
      key: occurrence === 0 ? identity : `${identity}:${occurrence}`,
    };
  });
}
