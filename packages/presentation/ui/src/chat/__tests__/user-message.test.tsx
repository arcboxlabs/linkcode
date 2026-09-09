// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { asyncNoop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandCatalogProvider } from '../command-brand';
import type { ConversationItem } from '../types';
import { UserMessage } from '../user-message';

function emptyText(): string {
  return '';
}

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useFormatter: () => ({ dateTime: emptyText }),
  useTranslations: () => translateKey,
}));

afterEach(cleanup);

describe('UserMessage', () => {
  it('renders an inline image between the surrounding text blocks', () => {
    const item: Extract<ConversationItem, { kind: 'message' }> = {
      id: 'user-image',
      kind: 'message',
      role: 'user',
      turnId: 'turn-1',
      blocks: [
        { type: 'text', text: 'before screenshot' },
        { type: 'image', data: 'cG5n', mimeType: 'image/png' },
        { type: 'text', text: 'after screenshot' },
      ],
      isStreaming: false,
    };

    const { container } = render(<UserMessage item={item} />);
    const before = screen.getByText('before screenshot');
    const image = container.querySelector('img');
    const after = screen.getByText('after screenshot');

    expect(image).not.toBeNull();
    if (!image) throw new Error('expected the user message image to render');
    expect(image.getAttribute('src')).toBe('data:image/png;base64,cG5n');
    expect(before.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(image.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('edits a cursor-backed prompt and preserves its inline image blocks', async () => {
    const onEditPrompt = vi.fn(asyncNoop);
    const item: Extract<ConversationItem, { kind: 'message' }> = {
      id: 'user-editable',
      kind: 'message',
      role: 'user',
      turnId: 'turn-1',
      blocks: [
        { type: 'text', text: 'original prompt' },
        { type: 'image', data: 'cG5n', mimeType: 'image/png' },
      ],
      isStreaming: false,
      branchCursor: 'opaque-cursor',
    };

    render(<UserMessage item={item} promptEditState="enabled" onEditPrompt={onEditPrompt} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const editor = screen.getByRole('textbox', { name: 'editPromptLabel' });
    expect(editor.closest('[data-role="user"]')).not.toBeNull();
    expect((editor as HTMLTextAreaElement).value).toBe('original prompt');
    fireEvent.change(editor, { target: { value: 'replacement prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'editSend' }));

    await waitFor(() => {
      expect(onEditPrompt).toHaveBeenCalledWith('user-editable', 'opaque-cursor', [
        { type: 'text', text: 'replacement prompt' },
        { type: 'image', data: 'cG5n', mimeType: 'image/png' },
      ]);
    });
  });

  it('edits a cursor-backed text prompt', async () => {
    const onEditPrompt = vi.fn(asyncNoop);
    const item: Extract<ConversationItem, { kind: 'message' }> = {
      id: 'user-editable',
      kind: 'message',
      role: 'user',
      turnId: 'turn-1',
      blocks: [{ type: 'text', text: 'original prompt' }],
      isStreaming: false,
      branchCursor: 'opaque-cursor',
    };

    render(<UserMessage item={item} promptEditState="enabled" onEditPrompt={onEditPrompt} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const editor = screen.getByRole('textbox', { name: 'editPromptLabel' });
    expect(editor.closest('[data-role="user"]')).not.toBeNull();
    expect((editor as HTMLTextAreaElement).value).toBe('original prompt');
    fireEvent.change(editor, { target: { value: 'replacement prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'editSend' }));

    await waitFor(() => {
      expect(onEditPrompt).toHaveBeenCalledWith('user-editable', 'opaque-cursor', [
        { type: 'text', text: 'replacement prompt' },
      ]);
    });
  });

  it('disables editing when the row carries a stored attachment', () => {
    const item: Extract<ConversationItem, { kind: 'message' }> = {
      id: 'user-attached',
      kind: 'message',
      role: 'user',
      turnId: 'turn-1',
      blocks: [
        { type: 'text', text: 'describe this' },
        { type: 'resource_link', uri: 'attachment:att-1', name: 'shot.png' },
      ],
      isStreaming: false,
      branchCursor: 'opaque-cursor',
    };

    render(<UserMessage item={item} promptEditState="enabled" onEditPrompt={vi.fn()} />);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'editAttachmentsUnsupported' })
        .disabled,
    ).toBe(true);
  });

  it('cancels inline editing without changing the prompt', () => {
    const item: Extract<ConversationItem, { kind: 'message' }> = {
      id: 'user-editable',
      kind: 'message',
      role: 'user',
      turnId: 'turn-1',
      blocks: [{ type: 'text', text: 'original prompt' }],
      isStreaming: false,
      branchCursor: 'opaque-cursor',
    };

    render(<UserMessage item={item} promptEditState="enabled" onEditPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'editPromptLabel' }), {
      target: { value: 'discarded edit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'editCancel' }));

    expect(screen.queryByRole('textbox', { name: 'editPromptLabel' })).toBeNull();
    expect(screen.getByText('original prompt')).toBeDefined();
  });

  it.each([
    { state: 'unsupported' as const, cursor: 'opaque-cursor', label: 'editUnsupported' },
    { state: 'busy' as const, cursor: 'opaque-cursor', label: 'editBusy' },
    { state: 'enabled' as const, cursor: undefined, label: 'editUnavailable' },
  ])('disables editing when $label', ({ state, cursor, label }) => {
    const item: Extract<ConversationItem, { kind: 'message' }> = {
      id: 'user-disabled',
      kind: 'message',
      role: 'user',
      turnId: 'turn-1',
      blocks: [{ type: 'text', text: 'prompt' }],
      isStreaming: false,
      branchCursor: cursor,
    };

    render(<UserMessage item={item} promptEditState={state} onEditPrompt={vi.fn()} />);

    expect(screen.getByRole<HTMLButtonElement>('button', { name: label }).disabled).toBe(true);
  });

  it('chips a catalog-matched command echo with its brand icon, leaving unknowns plain', () => {
    const echo = (text: string): Extract<ConversationItem, { kind: 'message' }> => ({
      id: `user-${text}`,
      kind: 'message',
      role: 'user',
      turnId: 'turn-1',
      blocks: [{ type: 'text', text }],
      isStreaming: false,
    });
    const commands = [
      {
        name: 'documents',
        displayName: 'Documents',
        iconDataUri: 'data:image/png;base64,cG5n',
        brandColor: '#2563EB',
      },
    ];

    const { container } = render(
      <CommandCatalogProvider commands={commands}>
        <UserMessage item={echo('/documents quarterly summary')} />
      </CommandCatalogProvider>,
    );
    const chip = screen.getByText('/documents');
    expect(chip).toBeDefined();
    expect(screen.getByText('quarterly summary')).toBeDefined();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,cG5n');
    // The provider's brandColor tints the chip; both mixes keep the brand hue.
    expect(chip.style.backgroundColor).toContain('rgb(37, 99, 235)');
    expect(chip.style.color).toContain('color-mix');

    cleanup();
    const plain = render(
      <CommandCatalogProvider commands={commands}>
        <UserMessage item={echo('/usr/bin/env is a path, not a command')} />
      </CommandCatalogProvider>,
    );
    expect(plain.container.querySelector('img')).toBeNull();
    expect(screen.getByText('/usr/bin/env is a path, not a command')).toBeDefined();

    // Multi-line arguments keep block rendering — a chip + bare span would collapse newlines.
    cleanup();
    const multiline = render(
      <CommandCatalogProvider commands={commands}>
        <UserMessage item={echo('/documents summarize this:\nline one\nline two')} />
      </CommandCatalogProvider>,
    );
    expect(multiline.container.querySelector('img')).toBeNull();
    expect(screen.queryByText('/documents')).toBeNull();
  });

  it('shows the version control for a turn with siblings and reports a switch', () => {
    const onSelectVersion = vi.fn();
    const item: Extract<ConversationItem, { kind: 'message' }> = {
      id: 'msg-turn-2',
      kind: 'message',
      role: 'user',
      turnId: 'turn-2',
      blocks: [{ type: 'text', text: 'second try' }],
      isStreaming: false,
    };
    render(
      <UserMessage
        item={item}
        version={{ index: 1, count: 3, state: null }}
        onSelectVersion={onSelectVersion}
      />,
    );
    expect(screen.getByText('versionOf')).toBeDefined();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'versionPrevious' }).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'versionNext' }));
    expect(onSelectVersion).toHaveBeenCalledWith(1);
  });

  it('badges a turn that did not complete and hides the arrows for an only child', () => {
    const item: Extract<ConversationItem, { kind: 'message' }> = {
      id: 'msg-turn-3',
      kind: 'message',
      role: 'user',
      turnId: 'turn-3',
      blocks: [{ type: 'text', text: 'went wrong' }],
      isStreaming: false,
    };
    render(<UserMessage item={item} version={{ index: 1, count: 1, state: 'failed' }} />);
    expect(screen.getByText('turnFailed')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'versionNext' })).toBeNull();
  });

  it('edits a graph-known prompt without a legacy branch cursor', async () => {
    const onEditPrompt = vi.fn(asyncNoop);
    const item: Extract<ConversationItem, { kind: 'message' }> = {
      id: 'msg-turn-4',
      kind: 'message',
      role: 'user',
      turnId: 'turn-4',
      blocks: [{ type: 'text', text: 'original prompt' }],
      isStreaming: false,
    };
    const { unmount } = render(
      <UserMessage
        item={item}
        promptEditState="enabled"
        version={{ index: 1, count: 1, state: null }}
        onEditPrompt={onEditPrompt}
      />,
    );
    // A known graph node on a harness whose edits still need a cursor stays uneditable.
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'editUnavailable' }).disabled,
    ).toBe(true);
    unmount();

    render(
      <UserMessage
        item={item}
        promptEditState="enabled"
        version={{ index: 1, count: 1, state: null }}
        rewritesViaGraph
        onEditPrompt={onEditPrompt}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    const editor = screen.getByRole('textbox', { name: 'editPromptLabel' });
    fireEvent.change(editor, { target: { value: 'replacement prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'editSend' }));
    await waitFor(() => {
      expect(onEditPrompt).toHaveBeenCalledWith('msg-turn-4', undefined, [
        { type: 'text', text: 'replacement prompt' },
      ]);
    });
  });
});
