import type { LexicalNode, NodeKey } from 'lexical';
import {
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
} from 'lexical';
import type { ComposerDirectiveState, DirectiveStatus } from './directive-state';
import { commandStatus, shellStatus } from './directive-state';
import { $isCommandNode, $isShellNode } from './nodes';

const WHITESPACE_RE = /\s/;

/** The draft as flat text. Chips contribute their canonical literals (`/name`, `$`, `"path"`),
 * so this equals what the plain-textarea composer would have held. */
export function $draftText(): string {
  return $getRoot().getTextContent();
}

function $flatOffsetOfNode(node: LexicalNode): number {
  let offset = 0;
  let current: LexicalNode | null = node;
  while (current !== null && !$isRootNode(current)) {
    let sibling = current.getPreviousSibling();
    while (sibling !== null) {
      offset += sibling.getTextContentSize();
      sibling = sibling.getPreviousSibling();
    }
    current = current.getParent();
  }
  return offset;
}

/** Caret position in the flat text, or null when there is no collapsed range selection (e.g. a
 * chip is node-selected). Drives the plus-menu query window and trigger identity. */
export function $caretFlatOffset(): number | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const { anchor } = selection;
  const node = anchor.getNode();
  if (anchor.type === 'text') return $flatOffsetOfNode(node) + anchor.offset;
  if (!$isElementNode(node)) return null;
  let offset = $flatOffsetOfNode(node);
  const children = node.getChildren();
  for (let i = 0; i < anchor.offset && i < children.length; i++) {
    offset += children[i].getTextContentSize();
  }
  return offset;
}

export interface EditorTrigger {
  kind: 'mention' | 'slash';
  query: string;
  /** Replacement target: the whole trigger token, as node-local offsets within `nodeKey`. Kept
   * node-local (never flat) so replacing can never straddle a chip. */
  nodeKey: NodeKey;
  start: number;
  end: number;
  /** Flat offset of the token start — stable identity for Escape-dismiss bookkeeping. */
  flatStart: number;
}

/**
 * The `@`/`/` trigger token at the caret, if any. Walks back through the anchor TextNode only:
 * a node boundary (typically a chip) counts as a token boundary, so a token can never span a
 * chip — which also means typing directly after a chip can open a fresh trigger.
 */
export function $computeEditorTrigger(): EditorTrigger | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const { anchor } = selection;
  if (anchor.type !== 'text') return null;
  const node = anchor.getNode();
  if (!$isTextNode(node)) return null;
  const content = node.getTextContent();
  const caret = anchor.offset;
  let start = caret;
  while (start > 0 && !WHITESPACE_RE.test(content[start - 1])) start--;
  const token = content.slice(start, caret);
  const kind = token[0] === '@' ? 'mention' : token[0] === '/' ? 'slash' : null;
  if (!kind) return null;
  return {
    end: caret,
    flatStart: $flatOffsetOfNode(node) + start,
    kind,
    nodeKey: node.getKey(),
    query: token.slice(1),
    start,
  };
}

/** Replace a trigger token with `node` (+ a separating space unless one follows), leaving the
 * caret after the insertion so the user keeps typing arguments. */
export function $replaceTriggerWith(trigger: EditorTrigger, node: LexicalNode): void {
  const target = $getNodeByKey(trigger.nodeKey);
  if (!$isTextNode(target)) return;
  const content = target.getTextContent();
  const end = Math.min(trigger.end, content.length);
  const start = Math.min(trigger.start, end);
  const selection = target.select(start, end);
  const needsSpace = !WHITESPACE_RE.test(content.charAt(end));
  selection.insertNodes(needsSpace ? [node, $createTextNode(' ')] : [node]);
}

export type DraftDirective =
  | { kind: 'command'; name: string; args: string; status: DirectiveStatus }
  | { kind: 'shell'; command: string; status: DirectiveStatus }
  | { kind: 'text'; text: string };

/**
 * Classify the draft for submit. Chips are the only way a draft becomes a directive — the
 * eager tokenizer materializes them, so plain text here is prose by construction and there is
 * no silent string-prefix parsing path anymore.
 */
export function $draftDirective(
  state: Pick<ComposerDirectiveState, 'commands' | 'commandsSupported' | 'shellEnabled'>,
): DraftDirective {
  const root = $getRoot();
  const text = root.getTextContent();
  const firstBlock = root.getFirstChild();
  const first = $isElementNode(firstBlock) ? firstBlock.getFirstChild() : null;
  if ($isCommandNode(first)) {
    const name = first.getName();
    return {
      args: text.slice(first.getTextContent().length).trim(),
      kind: 'command',
      name,
      status: commandStatus(name, state),
    };
  }
  if ($isShellNode(first)) {
    return { command: text.slice(1).trim(), kind: 'shell', status: shellStatus(state) };
  }
  return { kind: 'text', text: text.trim() };
}
