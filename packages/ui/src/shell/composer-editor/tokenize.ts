import { mergeRegister } from '@lexical/utils';
import type { LexicalEditor } from 'lexical';
import {
  $createTextNode,
  $getRoot,
  $hasUpdateTag,
  $isElementNode,
  $isTextNode,
  $nodesOfType,
  HISTORIC_TAG,
  TextNode,
} from 'lexical';
import { $createCommandNode, $createShellNode, CommandNode, ShellNode } from './nodes';

/** `/name` followed by a boundary the user already typed. */
const LEADING_COMMAND_RE = /^\/(\S+)\s/;
/** `/name` at draft end — only materialized on submit (`force`), so Enter right after the name
 * still routes through the directive path instead of slipping out as text. */
const LEADING_COMMAND_AT_END_RE = /^\/(\S+)$/;

/**
 * Keep directive chips and the document-leading position in sync, in both directions:
 *
 * - Promote: a first-child TextNode starting with `/name<ws>` or `$` becomes a chip — eagerly,
 *   even when the name is unknown (the chip then visibly errors instead of the draft silently
 *   becoming model chat). Strictly position 0: mid-text `/` and `$` are prose, and a
 *   whitespace-prefixed draft stays prose by construction.
 * - Demote: a chip that is no longer the document-leading child (text typed/pasted before it)
 *   melts back into its literal text — a directive is only meaningful at position 0.
 *
 * Both directions run in the same transform pass and are mutually exclusive per node, so the
 * pass is stable (no promote/demote cycles). `suppressed` skips exactly the literal the user
 * converted to text via the chip affordance.
 */
export function $normalizeLeadingDirectives(
  suppressed: string | null,
  opts: { force?: boolean } = {},
): void {
  const root = $getRoot();
  const firstBlock = root.getFirstChild();
  if (!$isElementNode(firstBlock)) return;

  for (const chip of [...$nodesOfType(CommandNode), ...$nodesOfType(ShellNode)]) {
    if (chip.getParent() === firstBlock && chip.getPreviousSibling() === null) continue;
    chip.replace($createTextNode(chip.getTextContent()));
  }

  const first = firstBlock.getFirstChild();
  if (!$isTextNode(first)) return;
  const text = first.getTextContent();

  if (text[0] === '$') {
    if (suppressed === '$') return;
    const token = text.length > 1 ? first.splitText(1)[0] : first;
    token.replace($createShellNode());
    return;
  }

  const match =
    LEADING_COMMAND_RE.exec(text) ?? (opts.force ? LEADING_COMMAND_AT_END_RE.exec(text) : null);
  if (!match) return;
  const name = match[1];
  if (suppressed === `/${name}`) return;
  const tokenLength = name.length + 1;
  const token = tokenLength < text.length ? first.splitText(tokenLength)[0] : first;
  token.replace($createCommandNode(name));
}

/** Register the directive tokenizer as node transforms (text edits promote, displaced chips
 * demote). Skips IME composition and history replays so undo is never immediately re-tokenized. */
export function registerDirectiveTokenizer(
  editor: LexicalEditor,
  getSuppressed: () => string | null,
): () => void {
  const run = (): void => {
    if (editor.isComposing() || $hasUpdateTag(HISTORIC_TAG)) return;
    $normalizeLeadingDirectives(getSuppressed());
  };
  return mergeRegister(
    editor.registerNodeTransform(TextNode, run),
    editor.registerNodeTransform(CommandNode, run),
    editor.registerNodeTransform(ShellNode, run),
  );
}
