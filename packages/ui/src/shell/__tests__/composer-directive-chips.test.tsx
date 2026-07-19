// @vitest-environment jsdom

import type { AgentCommand } from '@linkcode/schema';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LexicalEditor, NodeKey } from 'lexical';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  HISTORIC_TAG,
} from 'lexical';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComposerDirectiveControls } from '../composer';
import { Composer } from '../composer';
import { $createCommandNode, $createMentionNode, $createShellNode } from '../composer-editor/nodes';
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
afterEach(cleanup);

const COMMANDS: AgentCommand[] = [
  { name: 'compact', description: 'Compact the context' },
  { name: 'review', description: 'Review the changes' },
];
const RE_COMPACT_COMMAND = /\/compact/;
const CHIP_CASES = [
  ['command', () => $createCommandNode('review')],
  ['shell', () => $createShellNode()],
  ['mention', () => $createMentionNode('src/app.ts')],
] as const;
const CHIP_DELETION_CASES = CHIP_CASES.flatMap(([kind, createChip]) =>
  (['Backspace', 'Delete'] as const).map((key) => [kind, key, createChip] as const),
);

function hasNodeSelection(editor: LexicalEditor, nodeKey: NodeKey): boolean {
  return editor.read(() => {
    const selection = $getSelection();
    return $isNodeSelection(selection) && selection.has(nodeKey);
  });
}

function expectCaret(editor: LexicalEditor, nodeKey: NodeKey, offset: number): void {
  editor.read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) throw new Error('expected range selection');
    expect(selection.anchor.key).toBe(nodeKey);
    expect(selection.anchor.offset).toBe(offset);
  });
}

interface ComposerFixtureProps {
  agentCommands?: AgentCommand[];
  disabled?: boolean;
  onInvokeCommand?: (name: string, args?: string) => void;
  onRunShellCommand?: (command: string) => void;
  onSend?: React.ComponentProps<typeof Composer>['onSend'];
  shellSupported?: boolean;
  slashState?: ComposerDirectiveControls['slash']['state'];
}

function composer({
  agentCommands = COMMANDS,
  disabled = false,
  onInvokeCommand = vi.fn(),
  onRunShellCommand,
  onSend = vi.fn(),
  shellSupported = false,
  slashState = 'ready',
}: ComposerFixtureProps = {}): React.ReactNode {
  const slash: ComposerDirectiveControls['slash'] =
    slashState === 'unsupported'
      ? { state: 'unsupported' }
      : slashState === 'loading'
        ? { state: 'loading', onInvokeCommand }
        : { commands: agentCommands, state: 'ready', onInvokeCommand };
  const shell: ComposerDirectiveControls['shell'] = shellSupported
    ? { state: 'ready', onRunShellCommand: onRunShellCommand ?? vi.fn() }
    : { state: 'unsupported' };
  return (
    <Composer
      attachmentsSupported={false}
      currentModeId={null}
      disabled={disabled}
      directiveControls={{ shell, slash }}
      isRunning={false}
      onSend={onSend}
      onStop={vi.fn()}
    />
  );
}

describe('Composer directive chips', () => {
  it('explains an unknown command and blocks submit', async () => {
    const user = userEvent.setup();
    const onInvokeCommand = vi.fn();
    const onSend = vi.fn();
    render(composer({ onInvokeCommand, onSend }));

    typeInComposer('/typo ');
    const chip = screen.getByRole('button', { name: '/typo' });
    const status = screen.getByRole('status');
    expect(within(status).getByText('commandUnknown')).toBeDefined();
    const footer = status.closest('[data-slot="frame-panel-footer"]');
    const frame = status.closest('[data-slot="frame"]');
    expect(footer?.parentElement).toBe(frame);
    expect(status.closest('form')).toBeNull();
    await user.hover(chip);

    await waitFor(() => {
      const tooltip = document.querySelector('[data-slot="tooltip-popup"]');
      expect(tooltip?.textContent).toBe('commandUnknown');
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(true);
    await pressInComposer('Enter');
    expect(onInvokeCommand).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(composerText()).toBe('/typo ');
  });

  it('converts an unknown command to sendable prose', async () => {
    const user = userEvent.setup();
    const onInvokeCommand = vi.fn();
    const onSend = vi.fn();
    render(composer({ onInvokeCommand, onSend }));
    typeInComposer('/typo ');

    await user.click(screen.getByRole('button', { name: '/typo' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'removeDirective' })).toBeDefined();
    await user.click(within(menu).getByRole('menuitem', { name: 'convertToText' }));

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.queryByRole('button', { name: '/typo' })).toBeNull();
    typeInComposer('more');
    expect(composerText()).toBe('/typo more');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(false);
    await pressInComposer('Enter');
    expect(composerText()).toBe('');
    expect(onInvokeCommand).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledExactlyOnceWith([{ type: 'text', text: '/typo more' }]);
    expect(composerText()).toBe('');
  });

  it('updates an existing command chip when the catalog arrives', async () => {
    const onInvokeCommand = vi.fn();
    const onSend = vi.fn();
    const { rerender } = render(composer({ agentCommands: [], onInvokeCommand, onSend }));
    typeInComposer('/review ');

    expect(screen.getByRole('button', { name: '/review' })).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(true);
    rerender(composer({ agentCommands: COMMANDS, onInvokeCommand, onSend }));

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('button', { name: '/review' })).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(false);
    await pressInComposer('Enter');
    expect(onInvokeCommand).toHaveBeenCalledExactlyOnceWith('review', undefined);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('accepts a typed command while its catalog is loading', async () => {
    const onInvokeCommand = vi.fn();
    render(composer({ onInvokeCommand, slashState: 'loading' }));

    typeInComposer('/review ');

    expect(screen.getByRole('button', { name: '/review' }).getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    await pressInComposer('Enter');
    expect(onInvokeCommand).toHaveBeenCalledExactlyOnceWith('review', undefined);
  });

  it('keeps chip Enter out of submit and opens its action menu', async () => {
    const user = userEvent.setup();
    const onInvokeCommand = vi.fn();
    render(composer({ onInvokeCommand }));
    typeInComposer('/review ');
    const chip = screen.getByRole('button', { name: '/review' });

    chip.focus();
    await user.keyboard('{Enter}');
    expect(onInvokeCommand).not.toHaveBeenCalled();
    expect(await screen.findByRole('menu')).toBeDefined();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it.each(
    CHIP_CASES,
  )('selects the %s chip as an arrow stop and exits on the next arrow', async (_kind, createChip) => {
    render(composer());
    const editor = composerLexicalEditor();

    let chipKey: NodeKey = '';
    let leftKey: NodeKey = '';
    let rightKey: NodeKey = '';
    act(() => {
      editor.update(
        () => {
          const left = $createTextNode('a');
          const chip = createChip();
          const right = $createTextNode('b');
          chipKey = chip.getKey();
          leftKey = left.getKey();
          rightKey = right.getKey();
          $getRoot()
            .clear()
            .append($createParagraphNode().append(left, chip, right));
          left.selectEnd();
        },
        { discrete: true, tag: HISTORIC_TAG },
      );
    });
    const chip = editor.getElementByKey(chipKey)?.firstElementChild;
    if (!(chip instanceof HTMLElement)) throw new Error('expected rendered chip');

    await pressInComposer('ArrowRight');
    expect(hasNodeSelection(editor, chipKey)).toBe(true);
    await waitFor(() => expect(chip.dataset.selected).toBe('true'));

    await pressInComposer('ArrowRight');
    expectCaret(editor, rightKey, 0);
    await waitFor(() => expect(chip.dataset.selected).toBeUndefined());

    await pressInComposer('ArrowLeft');
    expect(hasNodeSelection(editor, chipKey)).toBe(true);

    await pressInComposer('ArrowLeft');
    expectCaret(editor, leftKey, 1);
  });

  it.each(
    CHIP_DELETION_CASES,
  )('deletes the selected %s chip with %s and preserves the caret', async (_kind, key, createChip) => {
    render(composer());
    const editor = composerLexicalEditor();

    let chipKey: NodeKey = '';
    let leftKey: NodeKey = '';
    act(() => {
      editor.update(
        () => {
          const left = $createTextNode('a');
          const chip = createChip();
          const right = $createTextNode('b');
          chipKey = chip.getKey();
          leftKey = left.getKey();
          $getRoot()
            .clear()
            .append($createParagraphNode().append(left, chip, right));
          left.selectEnd();
        },
        { discrete: true, tag: HISTORIC_TAG },
      );
    });

    await pressInComposer('ArrowRight');
    expect(hasNodeSelection(editor, chipKey)).toBe(true);
    await pressInComposer(key);

    expect(editor.getElementByKey(chipKey)).toBeNull();
    expect(composerText()).toBe('ab');
    expectCaret(editor, leftKey, 1);
  });

  it('recognizes a supported mid-line command and offers to move it to the start', async () => {
    const user = userEvent.setup();
    const onInvokeCommand = vi.fn();
    render(composer({ onInvokeCommand }));
    typeInComposer('please /review now');

    const chip = screen.getByRole('button', { name: '/review' });
    expect(chip.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(chip.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'commandMisplaced',
    );
    const status = screen.getByRole('status');
    expect(within(status).getByText('commandMisplaced')).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(true);

    await user.click(within(status).getByRole('button', { name: 'moveDirectiveToStart' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(composerText()).toBe('/review please now');
    await pressInComposer('Enter');
    expect(onInvokeCommand).toHaveBeenCalledExactlyOnceWith('review', 'please now');
  });

  it('blocks multiple directives until the extra chip is explicitly converted', async () => {
    const user = userEvent.setup();
    const onInvokeCommand = vi.fn();
    render(composer({ onInvokeCommand }));
    typeInComposer('/review /');
    await user.click(screen.getByRole('option', { name: RE_COMPACT_COMMAND }));

    const status = screen.getByRole('status');
    expect(within(status).getByText('multipleDirectives')).toBeDefined();
    await pressInComposer('Enter');
    expect(onInvokeCommand).not.toHaveBeenCalled();

    await user.click(within(status).getByRole('button', { name: 'convertToText' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(composerText()).toBe('/review /compact ');
    await pressInComposer('Enter');
    expect(onInvokeCommand).toHaveBeenCalledExactlyOnceWith('review', '/compact');
  });

  it('materializes a typed mid-line command when its live catalog arrives', async () => {
    const { rerender } = render(composer({ agentCommands: [] }));
    typeInComposer('please /review ');
    expect(screen.queryByRole('button', { name: '/review' })).toBeNull();

    rerender(composer({ agentCommands: COMMANDS }));

    expect(await screen.findByRole('button', { name: '/review' })).toBeDefined();
    expect(within(screen.getByRole('status')).getByText('commandMisplaced')).toBeDefined();
  });

  it('explains an unavailable shell directive and blocks submit', async () => {
    const user = userEvent.setup();
    const onRunShellCommand = vi.fn();
    const onSend = vi.fn();
    render(composer({ onRunShellCommand, onSend }));

    typeInComposer('$ ls -la');
    const shellChip = screen.getByRole('button', { name: '$' });
    const status = screen.getByRole('status');
    expect(within(status).getByText('shellUnsupported')).toBeDefined();
    await user.hover(shellChip);

    await waitFor(() => {
      const tooltip = document.querySelector('[data-slot="tooltip-popup"]');
      expect(tooltip?.textContent).toBe('shellUnsupported');
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(true);
    await pressInComposer('Enter');
    expect(onRunShellCommand).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(composerText()).toBe('$ ls -la');
  });

  it('runs a shell directive only through ready shell controls', async () => {
    const onRunShellCommand = vi.fn();
    render(composer({ onRunShellCommand, shellSupported: true }));

    typeInComposer('$ ls -la');
    await pressInComposer('Enter');

    expect(onRunShellCommand).toHaveBeenCalledExactlyOnceWith('ls -la');
  });

  it('disables chip and recovery actions with the composer', () => {
    const { rerender } = render(composer());
    typeInComposer('/typo ');

    rerender(composer({ disabled: true }));

    expect(screen.getByRole<HTMLButtonElement>('button', { name: '/typo' }).disabled).toBe(true);
    for (const action of within(screen.getByRole('status')).getAllByRole<HTMLButtonElement>(
      'button',
    )) {
      expect(action.disabled).toBe(true);
    }
  });

  it('relays command-menu navigation from the editor', async () => {
    render(composer());
    typeInComposer('/');
    expect(screen.getByRole('listbox')).toBeDefined();

    await pressInComposer('ArrowDown');
    await pressInComposer('Enter');

    expect(composerText()).toBe('/review ');
    expect(screen.getByRole('button', { name: '/review' })).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(composerTextbox()).toBeDefined();
  });
});
