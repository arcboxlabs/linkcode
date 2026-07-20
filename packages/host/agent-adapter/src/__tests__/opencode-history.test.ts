import type { AgentHistoryId } from '@linkcode/schema';
import type { AssistantMessage, Part, Session, UserMessage } from '@opencode-ai/sdk/v2';
import { describe, expect, it } from 'vitest';
import {
  filterRevertedMessages,
  mapOpencodeHistoryEvents,
  opencodeSessionToHistorySession,
  toolCallFromPart,
} from '../native/opencode/history';

const HISTORY_ID = 'ses-1' as AgentHistoryId;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'ses-1',
    slug: 'ses-1',
    projectID: 'proj-1',
    directory: '/tmp/repo',
    title: 'Fix the tests',
    version: '1.17.18',
    time: { created: 100, updated: 200 },
    ...overrides,
  };
}

function userMessage(id: string, created = 10): UserMessage {
  return {
    id,
    sessionID: 'ses-1',
    role: 'user',
    time: { created },
    agent: 'build',
    model: { providerID: 'openai', modelID: 'gpt-5.5' },
  };
}

function assistantMessage(id: string, created = 20): AssistantMessage {
  return {
    id,
    sessionID: 'ses-1',
    role: 'assistant',
    time: { created },
    parentID: 'msg-u1',
    modelID: 'gpt-5.5',
    providerID: 'openai',
    mode: 'build',
    agent: 'build',
    path: { cwd: '/tmp/repo', root: '/tmp/repo' },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

function textPart(id: string, messageID: string, text: string): Part {
  return { id, sessionID: 'ses-1', messageID, type: 'text', text };
}

function reasoningPart(id: string, messageID: string, text: string): Part {
  return { id, sessionID: 'ses-1', messageID, type: 'reasoning', text, time: { start: 1 } };
}

function completedToolPart(id: string, messageID: string): Extract<Part, { type: 'tool' }> {
  return {
    id,
    sessionID: 'ses-1',
    messageID,
    type: 'tool',
    callID: 'call-1',
    tool: 'bash',
    state: {
      status: 'completed',
      input: { command: 'echo hi' },
      output: 'hi\n',
      title: 'echo hi',
      metadata: {},
      time: { start: 1, end: 2 },
    },
  };
}

describe('opencodeSessionToHistorySession', () => {
  it('maps identity, directory, timestamps, and the provider/model join', () => {
    const session = opencodeSessionToHistorySession(
      makeSession({
        model: { id: 'gpt-5.5', providerID: 'openai' },
        parentID: 'ses-parent',
        time: { created: 100, updated: 200, archived: 300 },
      }),
    );
    expect(session).toMatchObject({
      historyId: 'ses-1',
      kind: 'opencode',
      title: 'Fix the tests',
      cwd: '/tmp/repo',
      model: 'openai/gpt-5.5',
      createdAt: 100,
      updatedAt: 200,
    });
    expect(session.metadata).toMatchObject({
      source: 'opencode-server',
      projectID: 'proj-1',
      parentID: 'ses-parent',
      archivedAt: 300,
    });
  });

  it('omits the model and empty titles instead of inventing values', () => {
    const session = opencodeSessionToHistorySession(makeSession({ title: '' }));
    expect(session.model).toBeUndefined();
    expect(session.title).toBeUndefined();
  });
});

describe('toolCallFromPart', () => {
  it('maps a completed state to the full snapshot with output content', () => {
    expect(toolCallFromPart(completedToolPart('prt-t1', 'msg-a1'))).toMatchObject({
      toolCallId: 'prt-t1',
      title: 'bash',
      status: 'completed',
      rawOutput: 'hi\n',
      content: [{ type: 'content', content: { type: 'text', text: 'hi\n' } }],
    });
  });

  it('maps an error state to failed with the error as content and no rawOutput', () => {
    const part = completedToolPart('prt-t1', 'msg-a1');
    part.state = {
      status: 'error',
      input: {},
      error: 'boom',
      time: { start: 1, end: 2 },
    };
    expect(toolCallFromPart(part)).toMatchObject({
      status: 'failed',
      rawOutput: undefined,
      content: [{ type: 'content', content: { type: 'text', text: 'boom' } }],
    });
  });

  it('maps running to in_progress and pending to pending', () => {
    const part = completedToolPart('prt-t1', 'msg-a1');
    part.state = { status: 'running', input: {}, time: { start: 1 } };
    expect(toolCallFromPart(part).status).toBe('in_progress');
    part.state = { status: 'pending', input: {}, raw: '' };
    expect(toolCallFromPart(part).status).toBe('pending');
  });
});

describe('filterRevertedMessages', () => {
  const messages = [
    { info: userMessage('msg-1'), parts: [] },
    { info: assistantMessage('msg-2'), parts: [] },
    { info: userMessage('msg-3'), parts: [] },
  ];

  it('drops the reverted message and everything after it', () => {
    const kept = filterRevertedMessages(messages, { messageID: 'msg-2' });
    expect(kept.map((m) => m.info.id)).toEqual(['msg-1']);
  });

  it('keeps everything when there is no revert or the id is unknown', () => {
    expect(filterRevertedMessages(messages, undefined)).toHaveLength(3);
    expect(filterRevertedMessages(messages, { messageID: 'msg-x' })).toHaveLength(3);
  });

  it('keeps everything for a partial (partID) revert rather than over-cutting', () => {
    expect(filterRevertedMessages(messages, { messageID: 'msg-2', partID: 'prt-1' })).toHaveLength(
      3,
    );
  });
});

describe('mapOpencodeHistoryEvents', () => {
  it('replays a user message as one whole user-message keyed by the message id', () => {
    const events = mapOpencodeHistoryEvents(HISTORY_ID, [
      {
        info: userMessage('msg-u1', 42),
        parts: [textPart('prt-1', 'msg-u1', 'first'), textPart('prt-2', 'msg-u1', 'second')],
      },
    ]);
    expect(events).toEqual([
      {
        historyId: HISTORY_ID,
        itemId: 'msg-u1',
        ts: 42,
        event: {
          type: 'user-message',
          messageId: 'msg-u1',
          content: [{ type: 'text', text: 'first\nsecond' }],
        },
      },
    ]);
  });

  it('skips a user message with no text', () => {
    expect(
      mapOpencodeHistoryEvents(HISTORY_ID, [
        { info: userMessage('msg-u1'), parts: [textPart('prt-1', 'msg-u1', '  ')] },
      ]),
    ).toEqual([]);
  });

  it('replays assistant parts keyed by part id — the live stream key — and skips bookkeeping parts', () => {
    const info = assistantMessage('msg-a1', 50);
    const events = mapOpencodeHistoryEvents(HISTORY_ID, [
      {
        info,
        parts: [
          { id: 'prt-s', sessionID: 'ses-1', messageID: 'msg-a1', type: 'step-start' },
          reasoningPart('prt-r1', 'msg-a1', 'thinking...'),
          textPart('prt-x1', 'msg-a1', 'the answer'),
          completedToolPart('prt-t1', 'msg-a1'),
        ],
      },
    ]);
    expect(events.map((e) => e.event.type)).toEqual([
      'agent-thought-chunk',
      'agent-message-chunk',
      'tool-call',
    ]);
    expect(events[0]).toMatchObject({ itemId: 'prt-r1', ts: 50 });
    expect(events[0].event).toMatchObject({ messageId: 'prt-r1' });
    expect(events[1].event).toMatchObject({
      messageId: 'prt-x1',
      content: { type: 'text', text: 'the answer' },
    });
    expect(events[2].event).toMatchObject({ toolCall: { toolCallId: 'prt-t1' } });
  });

  it('skips empty assistant text and reasoning parts', () => {
    const info = assistantMessage('msg-a1');
    expect(
      mapOpencodeHistoryEvents(HISTORY_ID, [
        { info, parts: [textPart('prt-1', 'msg-a1', ''), reasoningPart('prt-2', 'msg-a1', ' ')] },
      ]),
    ).toEqual([]);
  });
});
