import type { Conversation } from '@linkcode/client-core';
import type { ContentBlock, SessionId, TurnId } from '@linkcode/schema';
import { AttachmentIdSchema, userRowMessageId } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  clearInflightUserAttachments,
  isStoredAttachmentBlock,
  noteInflightUserAttachments,
  notePendingUserAttachments,
  overlayPendingUserAttachments,
  pendingUserAttachmentsSnapshot,
  promptBlocksFromComposer,
} from '../prompt-attachments';

const sessionId = 'sess-1' as SessionId;
const messageId = userRowMessageId('turn-1' as TurnId);

const EMPTY: Conversation = {
  items: [],
  status: null,
  usage: null,
  usageReport: null,
  currentModeId: null,
  approvalPolicy: null,
  currentModel: null,
  currentEffort: null,
  availableCommands: null,
  availableModels: null,
  capabilities: null,
  stopReason: null,
  pendingPermissionIds: [],
  pendingQuestionIds: [],
};

describe('promptBlocksFromComposer', () => {
  it('keeps text and converts stored attachment links to refs', () => {
    const attachmentId = AttachmentIdSchema.parse('att-1');
    expect(
      promptBlocksFromComposer([
        { type: 'text', text: 'look' },
        { type: 'resource_link', uri: `attachment:${attachmentId}`, name: 'shot.png' },
      ]),
    ).toEqual([
      { type: 'text', text: 'look' },
      { type: 'attachment_ref', attachmentId },
    ]);
  });

  it('refuses content that turn.submit cannot carry instead of dropping the block', () => {
    expect(
      promptBlocksFromComposer([
        { type: 'text', text: 'look' },
        { type: 'image', data: 'cG5n', mimeType: 'image/png' },
      ]),
    ).toBeUndefined();
    expect(
      promptBlocksFromComposer([
        { type: 'text', text: 'look' },
        { type: 'resource_link', uri: 'file:///tmp/a.ts', name: 'a.ts' },
      ]),
    ).toBeUndefined();
  });
});

describe('overlayPendingUserAttachments', () => {
  it('fills a text-only echo from pending store refs and yields to a durable row', () => {
    const link: ContentBlock = {
      type: 'resource_link',
      uri: 'attachment:att-1',
      name: 'shot.png',
    };
    notePendingUserAttachments(sessionId, messageId, [link]);
    const echo: Conversation = {
      ...EMPTY,
      items: [
        {
          kind: 'message',
          id: messageId,
          turnId: 'turn-1',
          role: 'user',
          blocks: [{ type: 'text', text: 'look' }],
          isStreaming: false,
        },
      ],
    };
    expect(
      overlayPendingUserAttachments(echo, sessionId, pendingUserAttachmentsSnapshot()).items[0],
    ).toMatchObject({
      blocks: [{ type: 'text', text: 'look' }, link],
    });

    const durable: Conversation = {
      ...EMPTY,
      items: [
        {
          kind: 'message',
          id: messageId,
          turnId: 'turn-1',
          role: 'user',
          blocks: [{ type: 'text', text: 'look' }, link],
          isStreaming: false,
        },
      ],
    };
    expect(
      overlayPendingUserAttachments(durable, sessionId, pendingUserAttachmentsSnapshot()).items[0],
    ).toMatchObject({
      blocks: [{ type: 'text', text: 'look' }, link],
    });
  });

  it('fills a live echo from inflight refs without painting an older user row', () => {
    const inflightSession = 'sess-inflight' as SessionId;
    const olderId = userRowMessageId('turn-0' as TurnId);
    const echoId = userRowMessageId('turn-2' as TurnId);
    const link: ContentBlock = {
      type: 'resource_link',
      uri: 'attachment:att-2',
      name: 'later.png',
    };
    noteInflightUserAttachments(inflightSession, [link]);
    const started = Date.now();
    const conversation: Conversation = {
      ...EMPTY,
      items: [
        {
          kind: 'message',
          id: olderId,
          turnId: 'turn-0',
          role: 'user',
          blocks: [{ type: 'text', text: 'previous' }],
          isStreaming: false,
          receivedAt: 1,
        },
        {
          kind: 'message',
          id: echoId,
          turnId: 'turn-2',
          role: 'user',
          blocks: [{ type: 'text', text: 'look' }],
          isStreaming: false,
          receivedAt: started + 1,
        },
      ],
    };
    const overlaid = overlayPendingUserAttachments(
      conversation,
      inflightSession,
      pendingUserAttachmentsSnapshot(),
    );
    expect(overlaid.items[0]).toMatchObject({
      blocks: [{ type: 'text', text: 'previous' }],
    });
    expect(overlaid.items[1]).toMatchObject({
      blocks: [{ type: 'text', text: 'look' }, link],
    });
    clearInflightUserAttachments(inflightSession);
    expect(
      overlayPendingUserAttachments(conversation, inflightSession, pendingUserAttachmentsSnapshot())
        .items[1],
    ).toMatchObject({
      blocks: [{ type: 'text', text: 'look' }],
    });
  });

  it('detects stored attachment links', () => {
    expect(
      isStoredAttachmentBlock({
        type: 'resource_link',
        uri: 'attachment:att-1',
        name: 'shot.png',
      }),
    ).toBe(true);
    expect(
      isStoredAttachmentBlock({
        type: 'resource_link',
        uri: 'file:///tmp/a.ts',
        name: 'a.ts',
      }),
    ).toBe(false);
  });
});
