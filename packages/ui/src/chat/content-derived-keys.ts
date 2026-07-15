import type { ContentBlock, ToolCallContent } from '@linkcode/schema';
import { simpleStringHash } from 'foxts/simple-string-hash';

type AdapterContent = ContentBlock | ToolCallContent;

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
