import type { LexicalNode, NodeKey, PointType } from 'lexical';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
} from 'lexical';
import type {
  ComposerDirectiveState,
  DirectivePlacementIssue,
  DirectiveStatus,
} from './directive-state';
import { commandStatus, shellStatus } from './directive-state';
import { $isCommandNode, $isShellNode } from './nodes';

const WHITESPACE_RE = /\s/;
const BLOCK_SEPARATOR_SIZE = 2;
const EMPTY_NODE_KEYS: ReadonlySet<NodeKey> = new Set();

function flatTextContribution(node: LexicalNode, hasFollowingSibling: boolean): number {
  const separator =
    hasFollowingSibling && $isElementNode(node) && !node.isInline() ? BLOCK_SEPARATOR_SIZE : 0;
  return node.getTextContentSize() + separator;
}

/** The draft as flat text. Chips contribute their canonical literals (`/name`, `$`, `"path"`). */
export function $draftText(): string {
  return $getRoot().getTextContent();
}

function $flatOffsetOfNode(node: LexicalNode): number {
  let offset = 0;
  let current: LexicalNode | null = node;
  while (current !== null && !$isRootNode(current)) {
    let sibling = current.getPreviousSibling();
    while (sibling !== null) {
      // ElementNode.getTextContent() separates non-inline siblings with two newlines; that
      // separator belongs before every following sibling but is not part of the block's size.
      offset += flatTextContribution(sibling, true);
      sibling = sibling.getPreviousSibling();
    }
    current = current.getParent();
  }
  return offset;
}

function $pointFlatOffset(point: PointType): number {
  const node = point.getNode();
  if (point.type === 'text') return $flatOffsetOfNode(node) + point.offset;
  if (!$isElementNode(node)) throw new Error('Element selection point must reference an element');
  let offset = $flatOffsetOfNode(node);
  const children = node.getChildren();
  for (let i = 0; i < point.offset && i < children.length; i++) {
    offset += flatTextContribution(children[i], i < children.length - 1);
  }
  return offset;
}

/** Caret position in the flat text, or null when there is no collapsed range selection (e.g. a
 * chip is node-selected). Drives the plus-menu query window and trigger identity. */
export function $caretFlatOffset(): number | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  return $pointFlatOffset(selection.anchor);
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
export function $computeEditorTrigger(
  suppressed: ReadonlySet<NodeKey> = EMPTY_NODE_KEYS,
): EditorTrigger | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const { anchor } = selection;
  let node: LexicalNode | null;
  let caret: number;
  if (anchor.type === 'text') {
    node = anchor.getNode();
    caret = anchor.offset;
  } else {
    // An element anchor sits between children (some selection restores land here); the token,
    // if any, ends at the tail of the child before the caret.
    const element = anchor.getNode();
    if (!$isElementNode(element)) return null;
    node = element.getChildAtIndex(anchor.offset - 1);
    caret = $isTextNode(node) ? node.getTextContentSize() : 0;
  }
  if (!$isTextNode(node)) return null;
  const content = node.getTextContent();
  let start = caret;
  while (start > 0 && !WHITESPACE_RE.test(content[start - 1])) start--;
  const token = content.slice(start, caret);
  const kind = token[0] === '@' ? 'mention' : token[0] === '/' ? 'slash' : null;
  if (!kind) return null;
  if (kind === 'slash' && start === 0 && suppressed.has(node.getKey())) {
    return null;
  }
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
  const nextCharacter = $draftText().charAt($flatOffsetOfNode(target) + end);
  const needsSpace = !WHITESPACE_RE.test(nextCharacter);
  selection.insertNodes(needsSpace ? [node, $createTextNode(' ')] : [node]);
}

/** Reset the draft to a single empty paragraph with the caret in it. */
export function $clearDraft(): void {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  root.append(paragraph);
  paragraph.select();
}

/** Insert plain text at the caret, falling back to the end of the draft when there is no
 * usable range selection (e.g. the editor is blurred or a chip is node-selected). */
export function $insertDraftText(text: string): void {
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    selection.insertText(text);
    return;
  }
  $getRoot().selectEnd().insertText(text);
}

/** Insert text with word-boundary spacing based on the range being replaced, not merely the
 * caret snapshot. This keeps imperative/plus-menu insertion correct for selected text. */
export function $insertSeparatedDraftText(text: string, trailing: boolean): void {
  const selection = $getSelection();
  const draft = $draftText();
  let start = draft.length;
  let end = draft.length;
  if ($isRangeSelection(selection)) {
    const anchor = $pointFlatOffset(selection.anchor);
    const focus = $pointFlatOffset(selection.focus);
    start = Math.min(anchor, focus);
    end = Math.max(anchor, focus);
  }
  const lead = start > 0 && !WHITESPACE_RE.test(draft.charAt(start - 1)) ? ' ' : '';
  const trail = trailing && !WHITESPACE_RE.test(draft.charAt(end)) ? ' ' : '';
  $insertDraftText(`${lead}${text}${trail}`);
}

/** Status-free directive identity mirrored out of the editor; catalog/capability validity stays
 * live in React rather than being frozen into a Lexical node. */
export type EditorDirective =
  | { kind: 'command'; name: string; nodeKey: NodeKey }
  | { kind: 'shell'; nodeKey: NodeKey };

export type DirectiveComposition =
  | { kind: 'none' }
  | { directive: EditorDirective; kind: 'ready' }
  | { directive: EditorDirective; issue: DirectivePlacementIssue; kind: 'blocked' };

interface DirectiveAnalysis {
  blockedKeys: readonly NodeKey[];
  composition: DirectiveComposition;
  leading: EditorDirective | null;
}

function $asEditorDirective(node: LexicalNode): EditorDirective | null {
  if ($isCommandNode(node)) {
    return { kind: 'command', name: node.getName(), nodeKey: node.getKey() };
  }
  if ($isShellNode(node)) return { kind: 'shell', nodeKey: node.getKey() };
  return null;
}

function $collectDirectives(node: LexicalNode, output: EditorDirective[]): void {
  const directive = $asEditorDirective(node);
  if (directive) {
    output.push(directive);
    return;
  }
  if (!$isElementNode(node)) return;
  for (const child of node.getChildren()) $collectDirectives(child, output);
}

/** Classify directive placement independently from catalog validity. AgentInput can represent
 * exactly one command or shell action, and that action owns the entire draft from offset zero. */
export function $analyzeDirectives(): DirectiveAnalysis {
  const root = $getRoot();
  const directives: EditorDirective[] = [];
  for (const child of root.getChildren()) $collectDirectives(child, directives);

  const firstBlock = root.getFirstChild();
  const first = $isElementNode(firstBlock) ? firstBlock.getFirstChild() : null;
  const leading = first ? $asEditorDirective(first) : null;
  if (directives.length === 0) {
    return { blockedKeys: [], composition: { kind: 'none' }, leading: null };
  }
  if (directives.length === 1 && leading) {
    return {
      blockedKeys: [],
      composition: { directive: leading, kind: 'ready' },
      leading,
    };
  }
  if (directives.length === 1) {
    return {
      blockedKeys: [directives[0].nodeKey],
      composition: { directive: directives[0], issue: 'misplaced', kind: 'blocked' },
      leading: null,
    };
  }
  const target = leading ? directives[1] : directives[0];
  return {
    blockedKeys: directives.map((directive) => directive.nodeKey),
    composition: { directive: target, issue: 'multiple', kind: 'blocked' },
    leading,
  };
}

/** Melt a directive chip back into its literal text (the explicit user opt-out) and return the
 * replacement node key, or null when the node is already gone. The caret moves to that token's
 * end so conversion cannot immediately reopen the `/` menu at the old boundary. */
export function $convertDirectiveToText(nodeKey: NodeKey): NodeKey | null {
  const node = $getNodeByKey(nodeKey);
  if (!node) return null;
  const literal = node.getTextContent();
  const text = $createTextNode(literal).toggleUnmergeable();
  node.replace(text);
  text.selectEnd();
  return text.getKey();
}

function $removeComposerChip(node: LexicalNode): void {
  const previous = node.getPreviousSibling();
  const next = node.getNextSibling();
  const previousEndsInWhitespace =
    $isTextNode(previous) && WHITESPACE_RE.test(previous.getTextContent().at(-1) ?? '');
  const nextStartsWithWhitespace =
    $isTextNode(next) && WHITESPACE_RE.test(next.getTextContent()[0] ?? '');

  if (nextStartsWithWhitespace && (!previous || previousEndsInWhitespace)) {
    next.setTextContent(next.getTextContent().slice(1));
    if (next.getTextContentSize() === 0 && !next.getNextSibling() && previousEndsInWhitespace) {
      previous.setTextContent(previous.getTextContent().slice(0, -1));
    }
  } else if (!next && previousEndsInWhitespace) {
    previous.setTextContent(previous.getTextContent().slice(0, -1));
  }

  if ($isTextNode(next)) next.select(0, 0);
  else if ($isTextNode(previous)) previous.selectEnd();
  else node.selectNext(0, 0);
  node.remove(true);
}

/** Remove a directive chip and its redundant boundary separator. */
export function $removeDirective(nodeKey: NodeKey): void {
  const node = $getNodeByKey(nodeKey);
  if (!$isCommandNode(node) && !$isShellNode(node)) return;
  $removeComposerChip(node);
}

/** Move a lone misplaced directive to offset zero, preserving the preceding prose as arguments. */
export function $moveDirectiveToStart(nodeKey: NodeKey): void {
  const node = $getNodeByKey(nodeKey);
  const firstBlock = $getRoot().getFirstChild();
  if (!node || !$isElementNode(firstBlock)) return;
  const first = firstBlock.getFirstChild();
  if (first === node) return;
  const previous = node.getPreviousSibling();
  const next = node.getNextSibling();
  if (
    $isTextNode(previous) &&
    $isTextNode(next) &&
    WHITESPACE_RE.test(previous.getTextContent().at(-1) ?? '') &&
    WHITESPACE_RE.test(next.getTextContent()[0] ?? '')
  ) {
    next.setTextContent(next.getTextContent().slice(1));
  }
  if (first) first.insertBefore(node);
  else firstBlock.append(node);
  const following = node.getNextSibling();
  if ($isTextNode(following) && WHITESPACE_RE.test(following.getTextContent()[0] ?? '')) {
    following.select(1, 1);
    return;
  }
  const separator = $createTextNode(' ');
  node.insertAfter(separator);
  separator.selectEnd();
}

type DraftDirective =
  | { kind: 'command'; name: string; args: string; status: DirectiveStatus }
  | { kind: 'shell'; command: string; status: DirectiveStatus }
  | { kind: 'invalid'; issue: DirectivePlacementIssue; directive: EditorDirective }
  | { kind: 'text'; text: string };

/**
 * Classify the draft for submit. Chips are the only way a draft becomes a directive — the
 * eager tokenizer materializes them, so plain text here is prose by construction and there is
 * no silent string-prefix parsing path anymore.
 */
export function $draftDirective(
  state: Pick<
    ComposerDirectiveState,
    'commands' | 'commandsSupported' | 'deferCommandValidation' | 'shellEnabled'
  >,
): DraftDirective {
  const root = $getRoot();
  const text = root.getTextContent();
  const analysis = $analyzeDirectives();
  if (analysis.composition.kind === 'blocked') {
    return {
      directive: analysis.composition.directive,
      issue: analysis.composition.issue,
      kind: 'invalid',
    };
  }
  const leading = analysis.composition.kind === 'ready' ? analysis.composition.directive : null;
  if (leading?.kind === 'command') {
    return {
      // The chip serializes as `/name` at flat offset 0; everything after it is argument text.
      args: text.slice(leading.name.length + 1).trim(),
      kind: 'command',
      name: leading.name,
      status: commandStatus(leading.name, state),
    };
  }
  if (leading?.kind === 'shell') {
    return { command: text.slice(1).trim(), kind: 'shell', status: shellStatus(state) };
  }
  return { kind: 'text', text: text.trim() };
}
