// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { asyncNoop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    const editor = screen.getByRole('textbox', { name: 'editPromptLabel' });
    expect((editor as HTMLTextAreaElement).value).toBe('original prompt');
    fireEvent.change(editor, { target: { value: 'replacement prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'editCreate' }));

    await waitFor(() => {
      expect(onEditPrompt).toHaveBeenCalledWith('user-editable', 'opaque-cursor', [
        { type: 'text', text: 'replacement prompt' },
        { type: 'image', data: 'cG5n', mimeType: 'image/png' },
      ]);
    });
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
});
