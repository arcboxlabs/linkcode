// @vitest-environment jsdom

import type { AgentCommand, AgentKind, SessionMode } from '@linkcode/schema';
import { MAX_ATTACHMENT_BYTES } from '@linkcode/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../composer';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

const COMMANDS: AgentCommand[] = [
  { name: 'compact', description: 'Compact the context' },
  { name: 'review', description: 'Review the changes' },
];
const MODES: SessionMode[] = [
  { modeId: 'plan', name: 'Plan', description: 'Research and propose changes' },
  { modeId: 'goal', name: 'Goal', description: 'Keep working toward a goal' },
];

function composer({
  agentKind,
  contextBar,
  disabled = false,
  mentionItems,
  onInvokeCommand,
  onSend = vi.fn(),
}: {
  agentKind?: AgentKind;
  contextBar?: React.ReactNode;
  disabled?: boolean;
  mentionItems?: React.ComponentProps<typeof Composer>['mentionItems'];
  onInvokeCommand?: (name: string, args?: string) => void;
  onSend?: React.ComponentProps<typeof Composer>['onSend'];
} = {}): React.ReactNode {
  return (
    <Composer
      agentCapabilities={{ shellCommand: false, slashCommands: true }}
      agentCommands={COMMANDS}
      agentKind={agentKind}
      attachmentsSupported={agentKind !== undefined}
      availableModes={MODES}
      currentModeId={null}
      contextBar={contextBar}
      disabled={disabled}
      isRunning={false}
      mentionItems={mentionItems}
      onInvokeCommand={onInvokeCommand}
      onModeChange={vi.fn().mockResolvedValue(undefined)}
      onSend={onSend}
      onStop={vi.fn()}
    />
  );
}

function renderComposer(): void {
  render(composer());
}

function imageFileWithSize(name: string, size: number): File {
  const file = new File([Uint8Array.from([137, 80, 78, 71])], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

afterEach(cleanup);

describe('Composer command menu', () => {
  it('renders an icon for matched and fallback file mentions', async () => {
    const user = userEvent.setup();
    render(
      composer({
        mentionItems: [
          { id: 'env', label: '.envrc', value: '.envrc' },
          { id: 'unknown', label: 'notes.unknown', value: 'notes.unknown' },
        ],
      }),
    );

    await user.type(screen.getByRole('textbox'), '@');

    expect(screen.getByRole('option', { name: '.envrc' }).querySelector('svg')).not.toBeNull();
    expect(
      screen.getByRole('option', { name: 'notes.unknown' }).querySelector('svg'),
    ).not.toBeNull();
  });

  it('keeps normal plus actions and modes searchable', async () => {
    const user = userEvent.setup();
    renderComposer();
    const input = screen.getByRole('textbox');

    await user.click(screen.getByRole('button', { name: 'add' }));
    expect(screen.getByText('attach')).toBeDefined();
    expect(screen.getByText('mentions')).toBeDefined();
    expect(screen.getByText('Plan')).toBeDefined();
    expect(screen.getByText('Goal')).toBeDefined();

    await user.type(input, 'pla');
    expect(screen.getByText('Plan')).toBeDefined();
    expect(screen.queryByText('Goal')).toBeNull();
  });

  it('gives a typed slash ownership of an open plus search', async () => {
    const user = userEvent.setup();
    renderComposer();
    const input = screen.getByRole('textbox');

    await user.click(screen.getByRole('button', { name: 'add' }));
    await user.type(input, '/');

    expect(screen.getByText('/compact')).toBeDefined();
    expect(screen.getByText('/review')).toBeDefined();
    expect(screen.queryByText('attach')).toBeNull();
    expect(screen.queryByText('mentions')).toBeNull();
    expect(screen.queryByText('Plan')).toBeNull();

    await user.type(input, ' ');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(screen.queryByText('/compact')).toBeNull());
    await user.keyboard('{Backspace}');
    expect(screen.getByText('/compact')).toBeDefined();
    expect(screen.queryByText('attach')).toBeNull();
  });

  it('keeps direct slash provider-command-only', async () => {
    const user = userEvent.setup();
    renderComposer();
    const input = screen.getByRole('textbox');

    await user.type(input, '/');

    expect(screen.getByRole('listbox')).toBeDefined();
    expect(screen.getByRole('option', { name: /\/compact/ })).toBeDefined();
    expect(screen.getByRole('option', { name: /\/review/ })).toBeDefined();
    expect(screen.getByTitle('Compact the context').textContent).toBe('Compact the context');
    expect(screen.queryByText('mentions')).toBeNull();
    expect(screen.queryByText('Plan')).toBeNull();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('textbox')).toBe(input);
    expect(document.activeElement).toBe(input);

    await user.keyboard('{Backspace}/');
    expect(screen.getByRole('listbox')).toBeDefined();
    expect(screen.getByRole('option', { name: /\/compact/ })).toBeDefined();
  });

  it('retains command rows only for the visual exit when disabled externally', async () => {
    const user = userEvent.setup();
    const { rerender } = render(composer());

    await user.type(screen.getByRole('textbox'), '/');
    expect(screen.getByText('/compact')).toBeDefined();

    rerender(composer({ disabled: true }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText('/compact')).toBeDefined();
    await waitFor(() => expect(screen.queryByText('/compact')).toBeNull());
  });

  it('keeps staged attachments out of a command invocation, then sends them with the next prompt', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onInvokeCommand = vi.fn();
    render(composer({ agentKind: 'claude-code', onInvokeCommand, onSend }));
    const input = screen.getByRole<HTMLTextAreaElement>('textbox');

    fireEvent.paste(input, {
      clipboardData: {
        files: [new File([Uint8Array.from([137, 80, 78, 71])], 'probe.png', { type: 'image/png' })],
      },
    });
    // The tray shows the preview image only once the file read settles into `ready`.
    await screen.findByRole('img', { name: 'probe.png' });

    await user.type(input, '/compact');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await user.keyboard('{Enter}');

    expect(onInvokeCommand).toHaveBeenCalledWith('compact', undefined);
    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe('');
    expect(screen.getByRole('img', { name: 'probe.png' })).toBeDefined();

    await user.type(input, 'ship it');
    await user.keyboard('{Enter}');

    expect(onSend).toHaveBeenCalledExactlyOnceWith([
      { type: 'text', text: 'ship it' },
      { type: 'image', data: expect.any(String) as string, mimeType: 'image/png' },
    ]);
    expect(screen.queryByRole('img', { name: 'probe.png' })).toBeNull();
  });

  it('localizes failed attachment controls and keeps a failed-only prompt unsendable', async () => {
    render(composer({ agentKind: 'claude-code' }));
    const input = screen.getByRole<HTMLTextAreaElement>('textbox');

    fireEvent.paste(input, {
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
    const input = screen.getByRole<HTMLTextAreaElement>('textbox');

    fireEvent.paste(input, {
      clipboardData: {
        files: [imageFileWithSize('too-large.png', MAX_ATTACHMENT_BYTES + 1)],
      },
    });
    await screen.findByText('attachmentFailed');

    fireEvent.paste(input, {
      clipboardData: {
        files: [imageFileWithSize('valid.png', MAX_ATTACHMENT_BYTES)],
      },
    });

    expect(await screen.findByRole('img', { name: 'valid.png' })).toBeDefined();
  });

  it('renders new-session context as a separate frame footer outside the form', () => {
    render(composer({ contextBar: <button type="button">Workspace context</button> }));

    const context = screen.getByRole('button', { name: 'Workspace context' });
    const footer = context.closest('[data-slot="frame-panel-footer"]');
    const frame = context.closest('[data-slot="frame"]');
    expect(footer).not.toBeNull();
    expect(footer?.parentElement).toBe(frame);
    expect(context.closest('form')).toBeNull();
    expect(frame?.querySelector('form')).not.toBeNull();
  });
});
