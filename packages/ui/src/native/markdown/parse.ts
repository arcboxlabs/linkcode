import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remend from 'remend';
import { unified } from 'unified';

// Same remark pipeline streamdown runs on web (remark-parse + remark-gfm + remend repair),
// so both renderers agree on the markdown dialect and on mid-stream repair behavior.
const processor = unified().use(remarkParse).use(remarkGfm);

/** Parse markdown into mdast; `streaming` repairs unterminated syntax (remend) first. */
export function parseMarkdown(source: string, streaming = false): Root {
  return processor.parse(streaming ? remend(source) : source);
}
