import type { ContentBlock } from '@linkcode/schema';

/** Flatten content blocks to plain text; non-text blocks render as a `[type]` placeholder. */
export function blocksToText(blocks: readonly ContentBlock[]): string {
  return blocks
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join('')
    .trim();
}

/** Compact token counts ("193437" → "193.4k") — mirrors the web CompactionMarker's format. */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}
