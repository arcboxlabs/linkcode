// @vitest-environment jsdom

import type { AgentCommand, AgentKind, SessionMode } from '@linkcode/schema';
import { MAX_ATTACHMENT_BYTES } from '@linkcode/schema';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  UNDO_COMMAND,
} from 'lexical';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComposerDirectiveControls, ComposerHandle } from '../composer';
import { Composer } from '../composer';
import {
  composerLexicalEditor,
  composerText,
  composerTextbox,
  pressInComposer,
  setupComposerTestDOM,
  typeInComposer,
} from './composer-test-utils';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

beforeAll(setupComposerTestDOM);

const COMMANDS: AgentCommand[] = [
  { name: 'compact', description: 'Compact the context' },
  { name: 'review', description: 'Review the changes' },
];
const MODES: SessionMode[] = [
  { modeId: 'plan', name: 'Plan', description: 'Research and propose changes' },
  { modeId: 'goal', name: 'Goal', description: 'Keep working toward a goal' },
];
const RE_COMPACT_COMMAND = /\/compact/;
const RE_REVIEW_COMMAND = /\/review/;

function composer({
  agentKind,
  contextBar,
  disabled = false,
  handleRef,
  mentionItems,
  onInvokeCommand,
  onMentionQueryChange,
  onSend = vi.fn(),
}: {
  agentKind?: AgentKind;
  contextBar?: React.ReactNode;
  disabled?: boolean;
  handleRef?: React.Ref<ComposerHandle>;
  mentionItems?: React.ComponentProps<typeof Composer>['mentionItems'];
  onInvokeCommand?: (name: string, args?: string) => void;
  onMentionQueryChange?: React.ComponentProps<typeof Composer>['onMentionQueryChange'];
  onSend?: React.ComponentProps<typeof Composer>['onSend'];
} = {}): React.ReactNode {
  return (
    <Composer
      agentKind={agentKind}
      attachmentsSupported={agentKind !== undefined}
      availableModes={MODES}
      currentModeId={null}
      contextBar={contextBar}
      disabled={disabled}
      directiveControls={
        {
          shell: { state: 'unsupported' },
          slash: {
            commands: COMMANDS,
            onInvokeCommand: onInvokeCommand ?? vi.fn(),
            state: 'ready',
          },
        } satisfies ComposerDirectiveControls
      }
      handleRef={handleRef}
      isRunning={false}
      mentionItems={mentionItems}
      onMentionQueryChange={onMentionQueryChange}
      onModeChange={vi.fn().mockResolvedValue(undefined)}
      onSend={onSend}
      onStop={vi.fn()}
    />
  );
}

function renderComposer(): void {
  render(composer());
}

/** State-level backspace: Lexical's `deleteCharacter` needs the non-standard `Selection.modify`
 * DOM API for collapsed selections, which jsdom lacks — so a key-driven Backspace can never
 * mutate the draft here. Deletes one char before the caret, or the node right before it. */
function backspaceInComposer(): void {
  const editor = composerLexicalEditor();
  act(() => {
    editor.update(
      () => {
        // Selection may have been dropped by jsdom's partial DOM-selection support between
        // updates; a real backspace always acts at the caret, which tests keep at the end.
        const currentSelection = $getSelection();
        const selection = $isRangeSelection(currentSelection)
          ? currentSelection
          : $getRoot().selectEnd();
        if (!selection.isCollapsed()) return;
        const { anchor } = selection;
        if (anchor.type === 'text') {
          const node = anchor.getNode();
          if ($isTextNode(node) && anchor.offset > 0) {
            node.spliceText(anchor.offset - 1, 1, '', true);
            return;
          }
          node.getPreviousSibling()?.remove();
          return;
        }
        const element = anchor.getNode();
        if ($isElementNode(element)) element.getChildAtIndex(anchor.offset - 1)?.remove();
      },
      { discrete: true },
    );
  });
}

function selectComposerText(start: number, end: number): void {
  act(() => {
    composerLexicalEditor().update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) throw new Error('expected paragraph');
        const text = paragraph.getFirstChildOrThrow();
        if (!$isTextNode(text)) throw new Error('expected text');
        text.select(start, end);
      },
      { discrete: true },
    );
  });
}

function imageFileWithSize(name: string, size: number): File {
  const file = new File([Uint8Array.from([137, 80, 78, 71])], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

afterEach(cleanup);

describe('Composer command menu', () => {
  it('keeps the input shell and inset frame radii synchronized', () => {
    const { container } = render(composer());
    const form = container.querySelector('form');
    const inputGroup = form?.querySelector('[data-slot="input-group"]');

    expect(inputGroup?.classList.contains('rounded-2xl')).toBe(true);
    expect(inputGroup?.classList.contains('before:rounded-2xl')).toBe(true);
    expect(form?.classList.contains('*:[[data-slot=input-group]]:rounded-xl')).toBe(false);

    typeInComposer('/');

    expect(form?.classList.contains('*:[[data-slot=input-group]]:rounded-xl')).toBe(true);
    expect(form?.classList.contains('*:[[data-slot=input-group]]:before:rounded-xl')).toBe(true);
  });

  it('exposes autocomplete semantics on the focused editor and preserves modified arrows', async () => {
    const { container } = render(composer());
    const editor = composerTextbox();
    const relay = container.querySelector<HTMLInputElement>('input.sr-only');

    expect(editor.getAttribute('role')).toBe('combobox');
    expect(editor.getAttribute('aria-expanded')).toBe('false');
    expect(editor.getAttribute('aria-controls')).toBeNull();
    expect(relay?.getAttribute('aria-hidden')).toBe('true');
    expect(relay?.getAttribute('role')).toBe('presentation');

    typeInComposer('/');
    const listbox = screen.getByRole('listbox');
    await waitFor(() => {
      expect(editor.getAttribute('aria-expanded')).toBe('true');
      expect(editor.getAttribute('aria-controls')).toBe(listbox.id);
      const active = document.getElementById(editor.getAttribute('aria-activedescendant') ?? '');
      expect(active?.getAttribute('role')).toBe('option');
    });

    const initialActive = editor.getAttribute('aria-activedescendant');
    for (const key of ['ArrowDown', 'ArrowUp']) {
      for (const modifier of [
        { altKey: true },
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
      ]) {
        expect(fireEvent.keyDown(editor, { code: key, key, ...modifier })).toBe(true);
        expect(editor.getAttribute('aria-activedescendant')).toBe(initialActive);
      }
    }

    await pressInComposer('ArrowDown');
    expect(editor.getAttribute('aria-activedescendant')).not.toBe(initialActive);
  });

  it('renders an icon for matched and fallback file mentions', () => {
    render(
      composer({
        mentionItems: [
          { id: 'env', label: '.envrc', value: '.envrc' },
          { id: 'unknown', label: 'notes.unknown', value: 'notes.unknown' },
        ],
      }),
    );

    typeInComposer('@');

    expect(screen.getByRole('option', { name: '.envrc' }).querySelector('svg')).not.toBeNull();
    expect(
      screen.getByRole('option', { name: 'notes.unknown' }).querySelector('svg'),
    ).not.toBeNull();
  });

  it('keeps normal plus actions and modes searchable', async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole('button', { name: 'add' }));
    expect(screen.getByText('attach')).toBeDefined();
    expect(screen.getByRole('option', { name: 'commands' })).toBeDefined();
    expect(screen.getByText('mentions')).toBeDefined();
    expect(screen.getByText('Plan')).toBeDefined();
    expect(screen.getByText('Goal')).toBeDefined();

    typeInComposer('pla');
    expect(screen.getByText('Plan')).toBeDefined();
    expect(screen.queryByText('Goal')).toBeNull();
  });

  it('opens a fresh mention query when the plus action inserts @', async () => {
    const user = userEvent.setup();
    const onMentionQueryChange = vi.fn();
    render(
      composer({
        mentionItems: [{ id: 'readme', label: 'README.md', value: 'README.md' }],
        onMentionQueryChange,
      }),
    );

    await user.click(screen.getByRole('button', { name: 'add' }));
    await user.click(screen.getByRole('option', { name: 'mentions' }));

    expect(composerText()).toBe('@');
    expect(onMentionQueryChange).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('option', { name: 'README.md' })).toBeDefined();
  });

  it('replaces selected text with a single-spaced mention trigger', async () => {
    const user = userEvent.setup();
    render(composer());
    typeInComposer('hello world');
    selectComposerText(6, 11);

    await user.click(screen.getByRole('button', { name: 'add' }));
    await user.click(screen.getByRole('option', { name: 'mentions' }));

    expect(composerText()).toBe('hello @');
  });

  it('replaces selected text through the imperative handle without duplicate spacing', () => {
    const handleRef = createRef<ComposerHandle>();
    render(composer({ handleRef }));
    typeInComposer('hello world');
    selectComposerText(6, 11);

    act(() => handleRef.current?.insertText('ref'));

    expect(composerText()).toBe('hello ref ');
  });

  it('opens the slash command list from the plus menu', async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole('button', { name: 'add' }));
    await user.click(screen.getByRole('option', { name: 'commands' }));

    expect(composerText()).toBe('/');
    expect(screen.getByRole('option', { name: RE_COMPACT_COMMAND })).toBeDefined();
    expect(screen.getByRole('option', { name: RE_REVIEW_COMMAND })).toBeDefined();
  });

  it('gives a typed slash ownership of an open plus search', async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole('button', { name: 'add' }));
    typeInComposer('/');

    expect(screen.getByText('/compact')).toBeDefined();
    expect(screen.getByText('/review')).toBeDefined();
    expect(screen.queryByText('attach')).toBeNull();
    expect(screen.queryByText('mentions')).toBeNull();
    expect(screen.queryByText('Plan')).toBeNull();

    typeInComposer(' ');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(screen.queryByText('/compact')).toBeNull());
    backspaceInComposer();
    expect(screen.getByText('/compact')).toBeDefined();
    expect(screen.queryByText('attach')).toBeNull();
  });

  it('keeps direct slash provider-command-only', async () => {
    renderComposer();
    const input = composerTextbox();
    act(() => {
      input.focus();
    });

    typeInComposer('/');

    expect(screen.getByRole('listbox')).toBeDefined();
    expect(screen.getByRole('option', { name: RE_COMPACT_COMMAND })).toBeDefined();
    expect(screen.getByRole('option', { name: RE_REVIEW_COMMAND })).toBeDefined();
    expect(screen.getByTitle('Compact the context').textContent).toBe('Compact the context');
    expect(screen.queryByText('mentions')).toBeNull();
    expect(screen.queryByText('Plan')).toBeNull();

    await pressInComposer('Escape');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    // jsdom does not reflect contenteditable focus through document.activeElement.
    expect(screen.getByRole('combobox')).toBe(input);

    backspaceInComposer();
    typeInComposer('/');
    expect(screen.getByRole('listbox')).toBeDefined();
    expect(screen.getByRole('option', { name: RE_COMPACT_COMMAND })).toBeDefined();
  });

  it('retains command rows only for the visual exit when disabled externally', async () => {
    const { rerender } = render(composer());

    typeInComposer('/');
    expect(screen.getByText('/compact')).toBeDefined();

    rerender(composer({ disabled: true }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText('/compact')).toBeDefined();
    await waitFor(() => expect(screen.queryByText('/compact')).toBeNull());
  });

  it('keeps staged attachments out of a command invocation, then sends them with the next prompt', async () => {
    const onSend = vi.fn();
    const onInvokeCommand = vi.fn();
    render(composer({ agentKind: 'claude-code', onInvokeCommand, onSend }));
    const input = composerTextbox();

    fireEvent.paste(input, {
      clipboardData: {
        files: [new File([Uint8Array.from([137, 80, 78, 71])], 'probe.png', { type: 'image/png' })],
      },
    });
    // The tray shows the preview image only once the file read settles into `ready`.
    const attachmentImage = await screen.findByRole('img', { name: 'probe.png' });
    const attachmentCard = attachmentImage.closest('[data-slot="card"]');
    expect(attachmentCard?.classList.contains('rounded-2xl')).toBe(true);
    expect(attachmentCard?.classList.contains('rounded-xl')).toBe(false);

    typeInComposer('/compact');
    await pressInComposer('Escape');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await pressInComposer('Enter');

    expect(onInvokeCommand).toHaveBeenCalledWith('compact', undefined);
    expect(onSend).not.toHaveBeenCalled();
    expect(composerText()).toBe('');
    expect(screen.getByRole('img', { name: 'probe.png' })).toBeDefined();

    act(() => {
      composerLexicalEditor().dispatchCommand(UNDO_COMMAND, undefined);
    });
    expect(composerText()).toBe('');

    typeInComposer('ship it');
    await pressInComposer('Enter');

    expect(onSend).toHaveBeenCalledExactlyOnceWith([
      { type: 'text', text: 'ship it' },
      { type: 'image', data: expect.any(String) as string, mimeType: 'image/png' },
    ]);
    expect(screen.queryByRole('img', { name: 'probe.png' })).toBeNull();
  });

  it('localizes failed attachment controls and keeps a failed-only prompt unsendable', async () => {
    render(composer({ agentKind: 'claude-code' }));

    fireEvent.paste(composerTextbox(), {
      clipboardData: {
        files: [imageFileWithSize('too-large.png', MAX_ATTACHMENT_BYTES + 1)],
      },
    });

    expect(await screen.findByText('attachmentFailed')).toBeDefined();
    expect(screen.getByRole('button', { name: 'removeAttachment' })).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(true);
  });

  it('does not count failed attachments toward the aggregate size limit', async () => {
    render(composer({ agentKind: 'claude-code' }));

    fireEvent.paste(composerTextbox(), {
      clipboardData: {
        files: [imageFileWithSize('too-large.png', MAX_ATTACHMENT_BYTES + 1)],
      },
    });
    await screen.findByText('attachmentFailed');

    fireEvent.paste(composerTextbox(), {
      clipboardData: {
        files: [imageFileWithSize('valid.png', MAX_ATTACHMENT_BYTES)],
      },
    });

    expect(await screen.findByRole('img', { name: 'valid.png' })).toBeDefined();
  });

  it('shares one frame footer between directive status and new-session context', () => {
    render(composer({ contextBar: <button type="button">Workspace context</button> }));
    typeInComposer('/typo ');

    const context = screen.getByRole('button', { name: 'Workspace context' });
    const status = screen.getByRole('status');
    const footer = context.closest('[data-slot="frame-panel-footer"]');
    const frame = context.closest('[data-slot="frame"]');
    expect(footer).not.toBeNull();
    expect(footer?.parentElement).toBe(frame);
    expect(status.closest('[data-slot="frame-panel-footer"]')).toBe(footer);
    expect(frame?.querySelectorAll('[data-slot="frame-panel-footer"]')).toHaveLength(1);
    expect(context.closest('form')).toBeNull();
    expect(status.closest('form')).toBeNull();
    expect(frame?.querySelector('form')).not.toBeNull();
  });
});
