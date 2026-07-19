import { mergeRegister } from '@lexical/utils';
import type { LexicalEditor } from 'lexical';
import {
  $getRoot,
  $hasUpdateTag,
  $isElementNode,
  $isTextNode,
  $nodesOfType,
  HISTORIC_TAG,
  LineBreakNode,
  TextNode,
} from 'lexical';
import type { ComposerDirectiveState } from './directive-state';
import { $createCommandNode, $createShellNode, $isCommandNode, $isShellNode } from './nodes';

const WHITESPACE_RE = /\s/;

type TokenizerState = Pick<ComposerDirectiveState, 'suppressed'>;

type DirectiveCandidate =
  | { end: number; kind: 'command'; name: string; start: number }
  | { end: number; kind: 'shell'; start: number };

function $isDocumentStart(node: TextNode, offset: number): boolean {
  if (offset !== 0 || node.getPreviousSibling() !== null) return false;
  const block = node.getParent();
  return block !== null && block === $getRoot().getFirstChild();
}

/** A command waits for a boundary the user actually typed, unless submit forces the final token. */
function $hasBoundaryAfter(node: TextNode, offset: number): boolean {
  const content = node.getTextContent();
  if (offset < content.length) return WHITESPACE_RE.test(content[offset]);
  const next = node.getNextSibling();
  if (next instanceof LineBreakNode) return true;
  if ($isTextNode(next)) return WHITESPACE_RE.test(next.getTextContent().slice(0, 1));
  const parent = node.getParent();
  return next === null && parent?.getNextSibling() !== null;
}

function $findDirectiveCandidate(
  node: TextNode,
  state: TokenizerState,
  force: boolean,
): DirectiveCandidate | null {
  const content = node.getTextContent();
  if (!$isDocumentStart(node, 0) || state.suppressed.has(node.getKey())) return null;

  if (content[0] === '$') {
    // A bare marker is ordinary prose. Shell intent becomes unambiguous only after the user
    // supplies a non-whitespace payload, including when that payload is in a following node.
    return $getRoot().getTextContent().slice(1).trim() ? { end: 1, kind: 'shell', start: 0 } : null;
  }
  if (content[0] !== '/') return null;
  let end = 1;
  while (end < content.length && !WHITESPACE_RE.test(content[end])) end++;
  const name = content.slice(1, end);
  if (!name || (!$hasBoundaryAfter(node, end) && !force)) return null;
  return { end, kind: 'command', name, start: 0 };
}

function $hasLeadingDirective(): boolean {
  const firstBlock = $getRoot().getFirstChild();
  if (!$isElementNode(firstBlock)) return false;
  const first = firstBlock.getFirstChild();
  return $isCommandNode(first) || $isShellNode(first);
}

function $replaceCandidate(node: TextNode, candidate: DirectiveCandidate): void {
  const length = node.getTextContentSize();
  let token: TextNode;
  if (candidate.start === 0 && candidate.end === length) token = node;
  else if (candidate.start === 0) [token] = node.splitText(candidate.end);
  else if (candidate.end === length) [, token] = node.splitText(candidate.start);
  else [, token] = node.splitText(candidate.start, candidate.end);
  token.replace(
    candidate.kind === 'command' ? $createCommandNode(candidate.name) : $createShellNode(),
  );
}

/**
 * Materialize directive-looking text without lying about execution. A leading command is chipped
 * even when unknown so it cannot silently fall through as model prose. Typed directives are
 * leading-only; explicit menu insertion may still create a misplaced chip whose validity is
 * classified separately by `$analyzeDirectives`.
 */
export function $normalizeDirectiveTokens(
  state: TokenizerState,
  opts: { force?: boolean } = {},
): void {
  let changed = true;
  while (changed) {
    // Everything after a leading directive is its raw argument/payload text. Do not reinterpret
    // `/name` inside command arguments or shell syntax as a second action.
    if ($hasLeadingDirective()) return;
    changed = false;
    for (const node of $nodesOfType(TextNode)) {
      const candidate = $findDirectiveCandidate(node, state, opts.force ?? false);
      if (!candidate) continue;
      $replaceCandidate(node, candidate);
      changed = true;
      break;
    }
  }
}

/** Register the tokenizer as node transforms. Skips IME composition and history replays so undo
 * is never immediately re-tokenized. */
export function registerDirectiveTokenizer(
  editor: LexicalEditor,
  getState: () => TokenizerState,
): () => void {
  const run = (): void => {
    if (editor.isComposing() || $hasUpdateTag(HISTORIC_TAG)) return;
    $normalizeDirectiveTokens(getState());
  };
  return mergeRegister(
    editor.registerNodeTransform(TextNode, run),
    editor.registerNodeTransform(LineBreakNode, run),
  );
}
