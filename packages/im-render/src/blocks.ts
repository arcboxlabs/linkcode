import type { ContentBlock } from '@linkcode/schema';

/**
 * ContentBlock → neutral Markdown. Non-text blocks degrade to a short labeled line (never a bare
 * `[image]` tag): binary payloads cannot cross an IM bridge inline, but the reader should still
 * see what was there.
 */
export function contentBlockToMarkdown(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'image':
      return block.uri === undefined
        ? `🖼\u{FE0F} *image (${block.mimeType})*`
        : `🖼\u{FE0F} [image](${block.uri})`;
    case 'audio':
      return `🎧 *audio (${block.mimeType})*`;
    case 'resource_link':
      return `📎 [${block.title ?? block.name}](${block.uri})`;
    case 'resource':
      return 'text' in block.resource
        ? fence(block.resource.text)
        : `📎 *resource (${block.resource.uri})*`;
    default:
      return '';
  }
}

export function contentToMarkdown(blocks: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const text = contentBlockToMarkdown(block);
    if (text.length > 0) parts.push(text);
  }
  return parts.join('\n\n');
}

const BACKTICK_RUN_RE = /`+/g;

/** Wrap `text` in a code fence that is guaranteed longer than any backtick run inside it. */
export function fence(text: string, lang = ''): string {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  let longestRun = 0;
  for (const run of body.matchAll(BACKTICK_RUN_RE)) {
    if (run[0].length > longestRun) longestRun = run[0].length;
  }
  const marker = '`'.repeat(Math.max(3, longestRun + 1));
  return `${marker}${lang}\n${body}\n${marker}`;
}

/** Cap a block of text at `max` lines, appending an elision note. No-op when `max` is undefined. */
export function capLines(text: string, max?: number): string {
  if (max === undefined) return text;
  const lines = text.split('\n');
  if (lines.length <= max) return text;
  return [...lines.slice(0, max), `… (+${lines.length - max} more lines)`].join('\n');
}

/** Prefix every line with `> ` (Markdown blockquote), used for reasoning/thoughts. */
export function blockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n');
}
