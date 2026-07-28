// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
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
});
