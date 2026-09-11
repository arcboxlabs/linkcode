import { describe, expect, it } from 'vitest';
import { ConversationOperationSchema, PromptRecordSchema, TurnInputSchema } from '../conversation';

describe('TurnInput', () => {
  it.each([
    { type: 'prompt', promptId: 'prompt-1' },
    { type: 'command', name: 'compact' },
    { type: 'command', name: 'review', arguments: 'apps/daemon' },
    { type: 'shell-command', command: 'git status' },
  ])('accepts $type input', (input) => {
    expect(TurnInputSchema.safeParse(input).success).toBe(true);
  });

  it('rejects a prompt input carrying content instead of a reference', () => {
    expect(
      TurnInputSchema.safeParse({ type: 'prompt', blocks: [{ type: 'text', text: 'x' }] }).success,
    ).toBe(false);
  });
});

describe('PromptRecord', () => {
  it('keeps blocks reference-only: no bytes, no unknown block kinds', () => {
    const base = { promptId: 'prompt-1', contextAttachmentIds: [], createdAt: 1 };
    expect(
      PromptRecordSchema.safeParse({
        ...base,
        blocks: [
          { type: 'text', text: 'see attached' },
          { type: 'attachment_ref', attachmentId: 'att-1' },
        ],
      }).success,
    ).toBe(true);
    expect(
      PromptRecordSchema.safeParse({
        ...base,
        blocks: [{ type: 'image', data: 'cG5n', mimeType: 'image/png' }],
      }).success,
    ).toBe(false);
  });
});

describe('ConversationOperation', () => {
  const base = { operationId: 'op-1', sessionId: 'session-1', kind: 'turn.submit', createdAt: 1 };

  it('binds the result shape to the state', () => {
    expect(ConversationOperationSchema.safeParse({ ...base, state: 'open' }).success).toBe(true);
    expect(
      ConversationOperationSchema.safeParse({
        ...base,
        state: 'succeeded',
        turnId: 'turn-1',
        resolvedAt: 2,
      }).success,
    ).toBe(true);
    expect(
      ConversationOperationSchema.safeParse({
        ...base,
        state: 'failed',
        error: { code: 'busy', message: 'A turn is already running' },
        resolvedAt: 2,
      }).success,
    ).toBe(true);
  });

  it('rejects a terminal state without its result', () => {
    expect(ConversationOperationSchema.safeParse({ ...base, state: 'succeeded' }).success).toBe(
      false,
    );
    expect(
      ConversationOperationSchema.safeParse({ ...base, state: 'failed', resolvedAt: 2 }).success,
    ).toBe(false);
  });
});
