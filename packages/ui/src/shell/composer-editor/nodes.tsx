import type { DOMExportOutput, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import { $applyNodeReplacement, DecoratorNode } from 'lexical';
import { CommandChip, MentionChip, ShellChip } from './chips';

/**
 * Inline atomic tokens for the composer draft. The invariant every node keeps: the editor's flat
 * text (concatenated `getTextContent()`) is byte-identical to what the plain-textarea composer
 * held — `/name` for a command, `$` for shell, a quoted relative path for a mention — so the
 * submit payloads and clipboard text stay agent-agnostic.
 */

function chipDOM(): HTMLElement {
  const span = document.createElement('span');
  // Atomic token: the reconciler owns the children (React portal); never user-editable inside.
  span.contentEditable = 'false';
  return span;
}

function exportCanonicalText(text: string): DOMExportOutput {
  return { element: document.createTextNode(text) };
}

export type SerializedCommandNode = Spread<{ name: string }, SerializedLexicalNode>;

/** A leading `/command` directive. Stores only the name — validity is derived live in the chip. */
export class CommandNode extends DecoratorNode<React.ReactNode> {
  __name: string;

  static override getType(this: void): string {
    return 'composer-command';
  }

  static override clone(this: void, node: CommandNode): CommandNode {
    return new CommandNode(node.__name, node.__key);
  }

  static override importJSON(this: void, serialized: SerializedCommandNode): CommandNode {
    return $createCommandNode(serialized.name);
  }

  constructor(name: string, key?: NodeKey) {
    super(key);
    this.__name = name;
  }

  override exportJSON(): SerializedCommandNode {
    return { ...super.exportJSON(), name: this.__name };
  }

  override createDOM(): HTMLElement {
    return chipDOM();
  }

  override updateDOM(): false {
    return false;
  }

  override exportDOM(): DOMExportOutput {
    return exportCanonicalText(this.getTextContent());
  }

  override getTextContent(): string {
    return `/${this.__name}`;
  }

  getName(): string {
    return this.getLatest().__name;
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }

  override decorate(): React.ReactNode {
    return <CommandChip name={this.__name} />;
  }
}

export function $createCommandNode(name: string): CommandNode {
  return $applyNodeReplacement(new CommandNode(name));
}

export function $isCommandNode(node: LexicalNode | null | undefined): node is CommandNode {
  return node instanceof CommandNode;
}

/** The leading `$` of a shell passthrough draft; the command itself stays editable text after it. */
export class ShellNode extends DecoratorNode<React.ReactNode> {
  static override getType(this: void): string {
    return 'composer-shell';
  }

  static override clone(this: void, node: ShellNode): ShellNode {
    return new ShellNode(node.__key);
  }

  static override importJSON(this: void): ShellNode {
    return $createShellNode();
  }

  override createDOM(): HTMLElement {
    return chipDOM();
  }

  override updateDOM(): false {
    return false;
  }

  override exportDOM(): DOMExportOutput {
    return exportCanonicalText(this.getTextContent());
  }

  override getTextContent(): string {
    return '$';
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }

  override decorate(): React.ReactNode {
    return <ShellChip />;
  }
}

export function $createShellNode(): ShellNode {
  return $applyNodeReplacement(new ShellNode());
}

export function $isShellNode(node: LexicalNode | null | undefined): node is ShellNode {
  return node instanceof ShellNode;
}

export type SerializedMentionNode = Spread<{ path: string }, SerializedLexicalNode>;

/** A file mention. Serializes as a quoted relative path: every agent understands that in prose
 * (its own fs tools read it), whereas `@path` is Claude-specific syntax. */
export class MentionNode extends DecoratorNode<React.ReactNode> {
  __path: string;

  static override getType(this: void): string {
    return 'composer-mention';
  }

  static override clone(this: void, node: MentionNode): MentionNode {
    return new MentionNode(node.__path, node.__key);
  }

  static override importJSON(this: void, serialized: SerializedMentionNode): MentionNode {
    return $createMentionNode(serialized.path);
  }

  constructor(path: string, key?: NodeKey) {
    super(key);
    this.__path = path;
  }

  override exportJSON(): SerializedMentionNode {
    return { ...super.exportJSON(), path: this.__path };
  }

  override createDOM(): HTMLElement {
    return chipDOM();
  }

  override updateDOM(): false {
    return false;
  }

  override exportDOM(): DOMExportOutput {
    return exportCanonicalText(this.getTextContent());
  }

  override getTextContent(): string {
    return `"${this.__path.replaceAll('"', String.raw`\"`)}"`;
  }

  getPath(): string {
    return this.getLatest().__path;
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }

  override decorate(): React.ReactNode {
    return <MentionChip path={this.__path} />;
  }
}

export function $createMentionNode(path: string): MentionNode {
  return $applyNodeReplacement(new MentionNode(path));
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
  return node instanceof MentionNode;
}

/** Every custom node the composer editor registers. */
export const COMPOSER_EDITOR_NODES = [CommandNode, ShellNode, MentionNode];
