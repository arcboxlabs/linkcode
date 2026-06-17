import type { ContentBlock } from '@linkcode/schema';

export function contentPreview(blocks: readonly ContentBlock[]): string {
  return blocks
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join(' ')
    .trim();
}
