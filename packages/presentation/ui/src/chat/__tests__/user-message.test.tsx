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

  it('edits a cursor-backed prompt and preserves its non-text blocks', async () => {
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
      { name: 'documents', displayName: 'Documents', iconDataUri: 'data:image/png;base64,cG5n' },
    ];

    const { container } = render(
      <CommandCatalogProvider commands={commands}>
        <UserMessage item={echo('/documents quarterly summary')} />
      </CommandCatalogProvider>,
    );
    expect(screen.getByText('/documents')).toBeDefined();
    expect(screen.getByText('quarterly summary')).toBeDefined();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,cG5n');

    cleanup();
    const plain = render(
      <CommandCatalogProvider commands={commands}>
        <UserMessage item={echo('/usr/bin/env is a path, not a command')} />
      </CommandCatalogProvider>,
    );
    expect(plain.container.querySelector('img')).toBeNull();
    expect(screen.getByText('/usr/bin/env is a path, not a command')).toBeDefined();
  });
});
