import { asHistoryId } from '@linkcode/agent-adapter';
import type {
  AgentEvent,
  AgentHistoryBranchOptions,
  AgentHistoryCapabilities,
  AgentHistoryReadOptions,
  SessionId,
  SessionRecord,
  WirePayload,
  WorkspaceId,
} from '@linkcode/schema';
import { MessageIdSchema, textBlock } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryProviderConfigStore } from '../agent/provider-config';
import type { SessionStore } from '../session/session-store';
import { InMemorySessionStore } from '../session/session-store';
import { InMemoryWorkspaceStore } from '../workspace/workspace-store';
import {
  FakeAdapter,
  createSessionHarness as harness,
  listedSessions,
  settleEngineTasks,
  startedSessionId as startedId,
  settleEngineTasks as tick,
} from './fixtures/session-harness';

class CwdlessHistoryAdapter extends FakeAdapter {
  override readHistory(opts: AgentHistoryReadOptions) {
    return Promise.resolve({
      session: {
        historyId: opts.historyId,
        kind: this.kind,
        title: 'Imported title',
        createdAt: 1111,
      },
      events: [],
    });
  }
}

class BranchingHistoryAdapter extends FakeAdapter {
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: true,
    resume: true,
    branch: true,
  };
  branchedFrom: AgentHistoryBranchOptions | null = null;

  branchHistory(opts: AgentHistoryBranchOptions, startOpts: Parameters<FakeAdapter['start']>[0]) {
    this.branchedFrom = opts;
    this.startedWith = startOpts;
    this.emit({ type: 'session-ref', historyId: asHistoryId('native-child') });
    return Promise.resolve();
  }

  override readHistory(opts: AgentHistoryReadOptions) {
    return Promise.resolve({
      session: {
        historyId: opts.historyId,
        kind: this.kind,
        cwd: '/repo',
      },
      events: [
        {
          historyId: opts.historyId,
          itemId: 'provider-source-message',
          event: {
            type: 'user-message' as const,
            messageId: MessageIdSchema.parse('provider-source-message'),
            content: [textBlock('Original prompt')],
            branchCursor: 'opaque-original-cursor',
          },
        },
        {
          historyId: opts.historyId,
          itemId: 'provider-later-message',
          event: {
            type: 'user-message' as const,
            messageId: MessageIdSchema.parse('provider-later-message'),
            content: [textBlock('Later prompt')],
            branchCursor: 'opaque-later-cursor',
          },
        },
      ],
    });
  }
}

class RejectingBranchAdapter extends BranchingHistoryAdapter {
  override branchHistory(): Promise<void> {
    return Promise.reject(new Error('provider fork failed'));
  }
}

class RejectingBranchedPromptAdapter extends BranchingHistoryAdapter {
  override send(): Promise<void> {
    return Promise.reject(new Error('edited prompt rejected'));
  }
}

class BlockingBranchAdapter extends BranchingHistoryAdapter {
  constructor(private readonly branchGate: Promise<void>) {
    super();
  }

  override branchHistory(
    opts: AgentHistoryBranchOptions,
    startOpts: Parameters<FakeAdapter['start']>[0],
  ): Promise<void> {
    return this.branchGate.then(() => super.branchHistory(opts, startOpts));
  }
}

class BlockingStopBranchAdapter extends BranchingHistoryAdapter {
  stopStarted = false;

  constructor(private readonly stopGate: Promise<void>) {
    super();
  }

  override stop(): Promise<void> {
    this.stopStarted = true;
    return this.stopGate.then(() => super.stop());
  }
}

class RejectingStopBranchAdapter extends BranchingHistoryAdapter {
  override stop(): Promise<void> {
    return Promise.reject(new Error('provider stop failed'));
  }
}

function listedWorkspaces(sent: Parameters<typeof listedSessions>[0], replyTo: string) {
  const listed = sent.find(
    (payload) => payload.kind === 'workspace.listed' && payload.replyTo === replyTo,
  );
  if (listed?.kind !== 'workspace.listed') throw new Error(`no workspace.listed for ${replyTo}`);
  return listed.workspaces;
}

function agentEvents(sent: WirePayload[], sessionId: SessionId): AgentEvent[] {
  return sent.flatMap((payload) =>
    payload.kind === 'agent.event' && payload.sessionId === sessionId ? [payload.event] : [],
  );
}

function promiseGate() {
  let open: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    promise,
    open() {
      if (open) open();
    },
  };
}

describe('engine session records', () => {
  it('persists created sessions with title and session-ref, and lists them cold after a restart', async () => {
    const store = new InMemorySessionStore();
    const first = harness(store);
    await first.engine.start();
    await first.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(first.sent, 'r1');
    first.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    await first.inject({
      kind: 'agent.input',
      clientReqId: 'r2',
      sessionId,
      input: { type: 'prompt', content: [textBlock('  Fix the   flaky\ntest  ')] },
    });

    const records = await store.load();
    expect(records).toHaveLength(1);
    expect(records[0].sessionId).toBe(sessionId);
    expect(records[0].origin).toEqual({ type: 'created' });
    expect(records[0].title).toBe('Fix the flaky test');
    expect(records[0].runs).toHaveLength(1);
    expect(records[0].runs[0].historyId).toBe('native-1');

    // A fresh engine over the same store lists the session cold.
    const second = harness(store);
    await second.engine.start();
    await second.inject({ kind: 'session.list', clientReqId: 'r3' });
    const sessions = listedSessions(second.sent, 'r3');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId,
      status: 'stopped',
      title: 'Fix the flaky test',
      cwd: '/repo',
      historyId: 'native-1',
    });
    expect(sessions[0].updatedAt).toBeTypeOf('number');
  });

  it('rewrites an idle session in place with rewind ordered before the replacement prompt', async () => {
    const store = new InMemorySessionStore();
    const h = harness(store, () => new BranchingHistoryAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'start-source',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sourceSessionId = startedId(h.sent, 'start-source');
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'source-prompt',
      sessionId: sourceSessionId,
      input: { type: 'prompt', content: [textBlock('Original prompt')] },
    });
    h.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-source') });
    h.adapters[0].emit({ type: 'status', status: 'idle' });

    await h.inject({
      kind: 'history.branch',
      clientReqId: 'rewrite',
      sourceSessionId,
      sourceMessageId: MessageIdSchema.parse('source-message'),
      branchCursor: 'opaque-cursor',
      content: [textBlock('edited prompt')],
    });
    await tick();

    expect(startedId(h.sent, 'rewrite')).toBe(sourceSessionId);
    expect(h.adapters[0].stopped).toBe(true);
    const replacementAdapter = h.adapters[1] as BranchingHistoryAdapter;
    expect(replacementAdapter.branchedFrom).toEqual({
      historyId: 'native-source',
      cursor: 'opaque-cursor',
    });
    expect(replacementAdapter.sentInputs).toEqual([
      { type: 'prompt', content: [textBlock('edited prompt')] },
    ]);
    expect(h.adapters[0].sentInputs).toEqual([
      { type: 'prompt', content: [textBlock('Original prompt')] },
    ]);

    const events = agentEvents(h.sent, sourceSessionId);
    const rewindIndex = events.findIndex((event) => event.type === 'conversation-rewind');
    const sessionRefIndex = events.findIndex(
      (event) => event.type === 'session-ref' && event.historyId === 'native-child',
    );
    const replacementIndex = events.findIndex(
      (event) =>
        event.type === 'user-message' &&
        event.content[0]?.type === 'text' &&
        event.content[0].text === 'edited prompt',
    );
    expect(rewindIndex).toBeGreaterThanOrEqual(0);
    expect(sessionRefIndex).toBeGreaterThan(rewindIndex);
    expect(replacementIndex).toBeGreaterThan(sessionRefIndex);

    const [record] = await store.load();
    expect(record).toMatchObject({
      sessionId: sourceSessionId,
      origin: { type: 'created' },
      cwd: '/repo',
      title: 'Original prompt',
    });
    expect(record.runs).toHaveLength(2);
    expect(record.runs[0]).toMatchObject({
      historyId: 'native-source',
      endedAt: expect.any(Number),
    });
    expect(record.runs[1]).toMatchObject({ historyId: 'native-child' });
    await h.inject({ kind: 'session.list', clientReqId: 'list' });
    expect(listedSessions(h.sent, 'list')).toHaveLength(1);
  });

  it('rewrites a stopped session under the same session id', async () => {
    const store = new InMemorySessionStore();
    const h = harness(store, () => new BranchingHistoryAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'start-source',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sourceSessionId = startedId(h.sent, 'start-source');
    h.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-source') });
    await h.inject({
      kind: 'session.stop',
      clientReqId: 'stop-source',
      sessionId: sourceSessionId,
    });

    await h.inject({
      kind: 'history.branch',
      clientReqId: 'rewrite-stopped',
      sourceSessionId,
      sourceMessageId: MessageIdSchema.parse('source-message'),
      branchCursor: 'opaque-cursor',
      content: [textBlock('edited prompt')],
    });

    await vi.waitFor(() => expect(startedId(h.sent, 'rewrite-stopped')).toBe(sourceSessionId));
    expect(await store.load()).toHaveLength(1);
  });

  it('serializes concurrent rewrites while replacing each live turn', async () => {
    const branchGate = promiseGate();
    const store = new InMemorySessionStore();
    const h = harness(store, () => new BlockingBranchAdapter(branchGate.promise));
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'start-source',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sourceSessionId = startedId(h.sent, 'start-source');
    h.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-source') });
    h.adapters[0].emit({ type: 'status', status: 'idle' });

    await h.inject({
      kind: 'history.branch',
      clientReqId: 'rewrite-one',
      sourceSessionId,
      sourceMessageId: MessageIdSchema.parse('source-message'),
      branchCursor: 'opaque-cursor',
      content: [textBlock('first edit')],
    });
    await vi.waitFor(() => expect(h.adapters).toHaveLength(2));
    await h.inject({
      kind: 'history.branch',
      clientReqId: 'rewrite-two',
      sourceSessionId,
      sourceMessageId: MessageIdSchema.parse('source-message'),
      branchCursor: 'opaque-cursor',
      content: [textBlock('second edit')],
    });

    branchGate.open();
    await vi.waitFor(() => expect(startedId(h.sent, 'rewrite-one')).toBe(sourceSessionId));
    await vi.waitFor(() => expect(startedId(h.sent, 'rewrite-two')).toBe(sourceSessionId));

    expect(h.adapters).toHaveLength(3);
    expect(h.adapters[1].stopped).toBe(true);
    expect(h.adapters[1].sentInputs).toEqual([
      { type: 'prompt', content: [textBlock('first edit')] },
    ]);
    expect(h.adapters[2].sentInputs).toEqual([
      { type: 'prompt', content: [textBlock('second edit')] },
    ]);
    const [record] = await store.load();
    expect(record.runs).toHaveLength(3);
  });

  it('stops a running turn before rewriting it in the same session', async () => {
    const stopGate = promiseGate();
    let adapterIndex = 0;
    const store = new InMemorySessionStore();
    const h = harness(store, () =>
      adapterIndex++ === 0
        ? new BlockingStopBranchAdapter(stopGate.promise)
        : new BranchingHistoryAdapter(),
    );
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'start-source',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sourceSessionId = startedId(h.sent, 'start-source');
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'source-prompt',
      sessionId: sourceSessionId,
      input: { type: 'prompt', content: [textBlock('Original prompt')] },
    });
    h.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-source') });
    h.adapters[0].emit({ type: 'status', status: 'running' });
    const sourceMessage = agentEvents(h.sent, sourceSessionId).findLast(
      (event) => event.type === 'user-message' && event.branchCursor !== undefined,
    );
    if (sourceMessage?.type !== 'user-message' || sourceMessage.branchCursor === undefined) {
      throw new Error('live source prompt has no branch cursor');
    }
    const eventMark = h.sent.length;

    await h.inject({
      kind: 'history.branch',
      clientReqId: 'rewrite-running',
      sourceSessionId,
      sourceMessageId: sourceMessage.messageId,
      branchCursor: sourceMessage.branchCursor,
      content: [textBlock('edited prompt')],
    });

    const sourceAdapter = h.adapters[0] as BlockingStopBranchAdapter;
    await vi.waitFor(() => expect(sourceAdapter.stopStarted).toBe(true));
    sourceAdapter.emit({
      type: 'agent-message-chunk',
      messageId: MessageIdSchema.parse('late-source-message'),
      content: textBlock('late source output'),
    });
    expect(h.adapters).toHaveLength(1);
    expect(
      agentEvents(h.sent.slice(eventMark), sourceSessionId).some(
        (event) => event.type === 'conversation-rewind',
      ),
    ).toBe(false);

    stopGate.open();
    await vi.waitFor(() => expect(startedId(h.sent, 'rewrite-running')).toBe(sourceSessionId));

    expect(sourceAdapter.stopped).toBe(true);
    const replacementAdapter = h.adapters[2] as BranchingHistoryAdapter;
    expect(replacementAdapter.branchedFrom).toEqual({
      historyId: 'native-source',
      cursor: 'opaque-original-cursor',
    });
    expect(replacementAdapter.sentInputs).toEqual([
      { type: 'prompt', content: [textBlock('edited prompt')] },
    ]);
    const replacementEvents = agentEvents(h.sent.slice(eventMark), sourceSessionId);
    expect(replacementEvents).not.toContainEqual({
      type: 'agent-message-chunk',
      messageId: 'late-source-message',
      content: textBlock('late source output'),
    });
    const rewindIndex = replacementEvents.findIndex(
      (event) => event.type === 'conversation-rewind',
    );
    const replacementIndex = replacementEvents.findIndex(
      (event) =>
        event.type === 'user-message' &&
        event.content[0]?.type === 'text' &&
        event.content[0].text === 'edited prompt',
    );
    expect(rewindIndex).toBeGreaterThanOrEqual(0);
    expect(replacementIndex).toBeGreaterThan(rewindIndex);

    const [record] = await store.load();
    expect(record.sessionId).toBe(sourceSessionId);
    expect(record.runs).toHaveLength(2);
    expect(record.runs[0].endedAt).toBeTypeOf('number');
  });

  it('rewrites an earlier live prompt from its original provider history', async () => {
    const store = new InMemorySessionStore();
    const h = harness(store, () => new BranchingHistoryAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'start-source',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sourceSessionId = startedId(h.sent, 'start-source');
    h.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-source') });
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'first-prompt',
      sessionId: sourceSessionId,
      input: { type: 'prompt', content: [textBlock('Original prompt')] },
    });
    h.adapters[0].emit({ type: 'status', status: 'idle' });
    const laterPromptMark = h.sent.length;
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'later-prompt',
      sessionId: sourceSessionId,
      input: { type: 'prompt', content: [textBlock('Later prompt')] },
    });
    expect(
      agentEvents(h.sent.slice(laterPromptMark), sourceSessionId).filter(
        (event) => event.type === 'user-message',
      ),
    ).toHaveLength(1);
    const livePrompts = agentEvents(h.sent, sourceSessionId).flatMap((event) =>
      event.type === 'user-message' && event.branchCursor !== undefined ? [event] : [],
    );
    const originalPrompt = livePrompts.findLast(
      (event) => event.content[0]?.type === 'text' && event.content[0].text === 'Original prompt',
    );
    const laterPrompt = livePrompts.findLast(
      (event) => event.content[0]?.type === 'text' && event.content[0].text === 'Later prompt',
    );
    if (
      originalPrompt?.type !== 'user-message' ||
      originalPrompt.branchCursor === undefined ||
      laterPrompt?.type !== 'user-message' ||
      laterPrompt.branchCursor === undefined
    ) {
      throw new Error('live prompts have no branch cursor');
    }

    await h.inject({
      kind: 'history.branch',
      clientReqId: 'rewrite-later',
      sourceSessionId,
      sourceMessageId: laterPrompt.messageId,
      branchCursor: laterPrompt.branchCursor,
      content: [textBlock('edited later prompt')],
    });
    await vi.waitFor(() => expect(startedId(h.sent, 'rewrite-later')).toBe(sourceSessionId));

    await h.inject({
      kind: 'history.branch',
      clientReqId: 'rewrite-original',
      sourceSessionId,
      sourceMessageId: originalPrompt.messageId,
      branchCursor: originalPrompt.branchCursor,
      content: [textBlock('edited original prompt')],
    });
    await vi.waitFor(() => expect(startedId(h.sent, 'rewrite-original')).toBe(sourceSessionId));

    expect((h.adapters[4] as BranchingHistoryAdapter).branchedFrom).toEqual({
      historyId: 'native-source',
      cursor: 'opaque-original-cursor',
    });
    const [record] = await store.load();
    expect(record.runs).toHaveLength(3);
  });

  it('does not rewind or start a replacement when stopping the running turn fails', async () => {
    const store = new InMemorySessionStore();
    const h = harness(store, () => new RejectingStopBranchAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'start-source',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sourceSessionId = startedId(h.sent, 'start-source');
    h.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-source') });
    h.adapters[0].emit({ type: 'status', status: 'running' });
    const eventMark = h.sent.length;

    await h.inject({
      kind: 'history.branch',
      clientReqId: 'rewrite-stop-failed',
      sourceSessionId,
      sourceMessageId: MessageIdSchema.parse('source-message'),
      branchCursor: 'opaque-cursor',
      content: [textBlock('edited prompt')],
    });
    await tick();

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'rewrite-stop-failed',
      code: 'operation_failed',
      message: 'Agent failed to stop',
    });
    expect(h.adapters).toHaveLength(1);
    expect(
      agentEvents(h.sent.slice(eventMark), sourceSessionId).some(
        (event) => event.type === 'conversation-rewind',
      ),
    ).toBe(false);
    const [record] = await store.load();
    expect(record.runs).toHaveLength(1);
    expect(record.runs[0]).toMatchObject({
      historyId: 'native-source',
      endedAt: expect.any(Number),
    });
  });

  it('keeps the original provider history recoverable when the provider fork fails', async () => {
    const store = new InMemorySessionStore();
    const h = harness(store, () => new RejectingBranchAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'start-source',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sourceSessionId = startedId(h.sent, 'start-source');
    h.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-source') });
    h.adapters[0].emit({ type: 'status', status: 'idle' });
    const eventMark = h.sent.length;

    await h.inject({
      kind: 'history.branch',
      clientReqId: 'branch-failed',
      sourceSessionId,
      sourceMessageId: MessageIdSchema.parse('source-message'),
      branchCursor: 'opaque-cursor',
      content: [textBlock('edited prompt')],
    });

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'branch-failed',
      code: 'operation_failed',
      message: 'Failed to branch agent history',
    });
    expect(
      h.sent
        .slice(eventMark)
        .some(
          (payload) =>
            payload.kind === 'agent.event' && payload.event.type === 'conversation-rewind',
        ),
    ).toBe(false);
    const [record] = await store.load();
    expect(record.runs).toHaveLength(2);
    expect(record.runs[1]).toMatchObject({ endedAt: expect.any(Number) });
    expect(record.runs[1].historyId).toBeUndefined();

    await h.inject({
      kind: 'session.resume',
      clientReqId: 'resume-source',
      sessionId: sourceSessionId,
    });
    expect(startedId(h.sent, 'resume-source')).toBe(sourceSessionId);
    expect(h.adapters[2].resumedFrom).toBe('native-source');
  });

  it('keeps the replacement run in the same session when its edited prompt is rejected', async () => {
    const store = new InMemorySessionStore();
    const h = harness(store, () => new RejectingBranchedPromptAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'start-source',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sourceSessionId = startedId(h.sent, 'start-source');
    h.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-source') });
    h.adapters[0].emit({ type: 'status', status: 'idle' });

    await h.inject({
      kind: 'history.branch',
      clientReqId: 'prompt-failed',
      sourceSessionId,
      sourceMessageId: MessageIdSchema.parse('source-message'),
      branchCursor: 'opaque-cursor',
      content: [textBlock('edited prompt')],
    });
    await tick();

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'prompt-failed',
      code: 'operation_failed',
      message: 'Agent input was rejected',
      reportedInConversation: true,
    });
    const records = await store.load();
    expect(records).toHaveLength(1);
    expect(records[0].sessionId).toBe(sourceSessionId);
    expect(records[0].runs.at(-1)?.historyId).toBe('native-child');
    expect(agentEvents(h.sent, sourceSessionId)).toContainEqual({
      type: 'conversation-rewind',
      messageId: 'source-message',
    });
  });

  it('resumes a persisted session under the same id, appending a run', async () => {
    const store = new InMemorySessionStore();
    const first = harness(store);
    await first.engine.start();
    await first.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(first.sent, 'r1');
    first.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    await first.inject({ kind: 'session.stop', clientReqId: 'r2', sessionId });

    const second = harness(store);
    await second.engine.start();
    await second.inject({ kind: 'session.resume', clientReqId: 'r3', sessionId });
    expect(startedId(second.sent, 'r3')).toBe(sessionId);
    expect(second.adapters[0].resumedFrom).toBe('native-1');

    const [record] = await store.load();
    expect(record.runs).toHaveLength(2);
    expect(record.runs[0].endedAt).toBeTypeOf('number');
    expect(record.runs[1].historyId).toBe('native-1');
  });

  it('replaces the first-prompt fallback with a provider title and dedupes repeats', async () => {
    const store = new InMemorySessionStore();
    const h = harness(store);
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'r2',
      sessionId,
      input: { type: 'prompt', content: [textBlock('Investigate the login regression')] },
    });
    const changesBeforeTitle = h.sent.filter(
      (payload) => payload.kind === 'session.changed',
    ).length;

    h.adapters[0].emit({ type: 'title-update', title: 'Fix OAuth callback handling' });
    h.adapters[0].emit({ type: 'title-update', title: 'Fix OAuth callback handling' });
    await settleEngineTasks();

    expect((await store.load())[0].title).toBe('Fix OAuth callback handling');
    expect(h.sent.filter((payload) => payload.kind === 'session.changed')).toHaveLength(
      changesBeforeTitle + 1,
    );
    expect(h.sent.findLast((payload) => payload.kind === 'session.changed')).toEqual({
      kind: 'session.changed',
      sessionId,
      reason: 'updated',
    });

    const restarted = harness(store);
    await restarted.engine.start();
    await restarted.inject({ kind: 'session.list', clientReqId: 'r3' });
    expect(listedSessions(restarted.sent, 'r3')[0].title).toBe('Fix OAuth callback handling');
  });

  it('does not replace an automation title with provider metadata', async () => {
    const store = new InMemorySessionStore();
    const sessionId = 'automation-session' as SessionId;
    await store.save({
      sessionId,
      kind: 'claude-code',
      cwd: '/repo',
      title: 'Nightly dependency update',
      origin: { type: 'created' },
      automation: { kind: 'schedule', id: 'schedule-1' },
      createdAt: 1,
      updatedAt: 2,
      runs: [{ historyId: asHistoryId('native-1'), startedAt: 1, endedAt: 2 }],
    });
    const h = harness(store);
    await h.engine.start();
    await h.inject({ kind: 'session.resume', clientReqId: 'r1', sessionId });
    const changesBeforeTitle = h.sent.filter(
      (payload) => payload.kind === 'session.changed',
    ).length;

    h.adapters[0].emit({ type: 'title-update', title: 'Provider generated title' });
    await settleEngineTasks();

    expect((await store.load())[0].title).toBe('Nightly dependency update');
    expect(h.sent.filter((payload) => payload.kind === 'session.changed')).toHaveLength(
      changesBeforeTitle,
    );
  });

  it('imports a provider history session as a cold record', async () => {
    const { engine, sent, inject } = harness();
    await engine.start();
    await inject({
      kind: 'session.import',
      clientReqId: 'r1',
      agentKind: 'claude-code',
      historyId: asHistoryId('native-9'),
    });

    const imported = sent.find((p) => p.kind === 'session.imported');
    if (imported?.kind !== 'session.imported') throw new Error('no session.imported reply');
    expect(imported.record).toMatchObject({
      kind: 'claude-code',
      cwd: '/imported',
      title: 'Imported title',
      origin: { type: 'imported', historyId: 'native-9' },
      createdAt: 1111,
      runs: [],
    });

    await inject({ kind: 'session.list', clientReqId: 'r2' });
    expect(listedSessions(sent, 'r2')[0].status).toBe('stopped');

    await inject({ kind: 'workspace.list', clientReqId: 'r3' });
    expect(listedWorkspaces(sent, 'r3')).toEqual([
      expect.objectContaining({ cwd: '/imported', name: 'imported', kind: 'project' }),
    ]);
  });

  it('serializes concurrent imports of the same provider history', async () => {
    const store = new InMemorySessionStore();
    const { engine, sent, inject } = harness(store);
    await engine.start();
    const request = {
      kind: 'session.import' as const,
      agentKind: 'claude-code' as const,
      historyId: asHistoryId('native-9'),
    };

    await Promise.all([
      inject({ ...request, clientReqId: 'r1' }),
      inject({ ...request, clientReqId: 'r2' }),
    ]);

    const imported = sent.filter((payload) => payload.kind === 'session.imported');
    expect(imported).toHaveLength(2);
    expect(new Set(imported.map((payload) => payload.record.sessionId)).size).toBe(1);
    expect(await store.load()).toHaveLength(1);
  });

  it('does not register a workspace when imported history has no cwd', async () => {
    const h = harness(new InMemorySessionStore(), () => new CwdlessHistoryAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.import',
      clientReqId: 'r1',
      agentKind: 'claude-code',
      historyId: asHistoryId('native-9'),
    });

    await h.inject({ kind: 'workspace.list', clientReqId: 'r2' });
    expect(listedWorkspaces(h.sent, 'r2')).toEqual([]);
  });

  it('keeps an existing registered workspace when importing history from its cwd', async () => {
    const workspaceStore = new InMemoryWorkspaceStore();
    await workspaceStore.save({
      workspaceId: 'ws-existing' as WorkspaceId,
      cwd: '/imported',
      name: 'Custom project name',
      kind: 'project',
      createdAt: 1,
      lastUsedAt: 1,
    });
    const h = harness(undefined, undefined, undefined, undefined, workspaceStore);
    await h.engine.start();
    await h.inject({
      kind: 'session.import',
      clientReqId: 'r1',
      agentKind: 'claude-code',
      historyId: asHistoryId('native-9'),
    });

    await h.inject({ kind: 'workspace.list', clientReqId: 'r2' });
    expect(listedWorkspaces(h.sent, 'r2')).toEqual([
      expect.objectContaining({
        workspaceId: 'ws-existing',
        cwd: '/imported',
        name: 'Custom project name',
      }),
    ]);
  });

  it('backfills projects for existing imported sessions without changing created sessions', async () => {
    const sessionStore = new InMemorySessionStore();
    const imported: SessionRecord = {
      sessionId: 's-imported' as SessionId,
      kind: 'claude-code',
      cwd: '/legacy/imported-project',
      title: 'Imported title',
      origin: { type: 'imported', historyId: asHistoryId('native-9'), importedAt: 2 },
      createdAt: 1,
      updatedAt: 2,
      runs: [],
    };
    const created: SessionRecord = {
      sessionId: 's-created' as SessionId,
      kind: 'claude-code',
      cwd: '/legacy/created-project',
      origin: { type: 'created' },
      createdAt: 1,
      updatedAt: 2,
      runs: [],
    };
    await sessionStore.save(imported);
    await sessionStore.save(created);

    const h = harness(sessionStore);
    await h.engine.start();
    await h.inject({ kind: 'workspace.list', clientReqId: 'r1' });

    expect(listedWorkspaces(h.sent, 'r1')).toEqual([
      expect.objectContaining({ cwd: '/legacy/imported-project', name: 'imported-project' }),
    ]);
  });

  it('retries an imported session after its first durable save fails', async () => {
    const inner = new InMemorySessionStore();
    let shouldFail = true;
    const store: SessionStore = {
      load: () => inner.load(),
      save(record) {
        if (shouldFail) {
          shouldFail = false;
          return Promise.reject(new Error('private database detail'));
        }
        return inner.save(record);
      },
      delete: (sessionId) => inner.delete(sessionId),
    };
    const { engine, sent, inject } = harness(store);
    await engine.start();
    await inject({
      kind: 'session.import',
      clientReqId: 'r1',
      agentKind: 'claude-code',
      historyId: asHistoryId('native-9'),
    });

    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r1',
      code: 'operation_failed',
      message: 'Failed to persist session record',
    });
    expect(
      sent.some((payload) => JSON.stringify(payload).includes('private database detail')),
    ).toBe(false);
    await inject({ kind: 'session.list', clientReqId: 'r2' });
    expect(listedSessions(sent, 'r2')).toEqual([]);

    await inject({
      kind: 'session.import',
      clientReqId: 'r3',
      agentKind: 'claude-code',
      historyId: asHistoryId('native-9'),
    });
    await inject({ kind: 'session.list', clientReqId: 'r4' });
    expect(listedSessions(sent, 'r4')).toHaveLength(1);
    expect(await inner.load()).toHaveLength(1);
  });
});

describe('session account attribution', () => {
  function storeBoundTo(accountId: string, model: string): InMemoryProviderConfigStore {
    const providers = new InMemoryProviderConfigStore();
    providers.update({
      providers: { 'claude-code': { enabled: true, activeAccountId: accountId, model } },
      accounts: [
        {
          id: accountId,
          label: 'Bound',
          service: 'anthropic-api',
          credential: { type: 'api-key', key: 'sk-test' },
          models: [{ id: model }],
          createdAt: 0,
        },
      ],
    });
    return providers;
  }

  it("records the account a run resolved to and reports the latest run's", async () => {
    const providers = storeBoundTo('acc_bound', 'claude-opus-5');
    const store = new InMemorySessionStore();
    const h = harness(store, undefined, undefined, undefined, undefined, providers);
    await h.engine.start();

    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    await h.inject({ kind: 'session.list', clientReqId: 'r2' });

    expect(listedSessions(h.sent, 'r2')[0]?.accountId).toBe('acc_bound');
    // Persisted per run, so a restart still knows what the session is talking to.
    expect((await store.load())[0].runs[0].accountId).toBe('acc_bound');
  });

  it('honours an account the client pinned over the bound one', async () => {
    const providers = storeBoundTo('acc_bound', 'claude-opus-5');
    const pool = providers.getAccounts();
    providers.update({
      accounts: [
        ...pool,
        {
          id: 'acc_pinned',
          label: 'Pinned',
          service: 'anthropic-api',
          credential: { type: 'api-key', key: 'sk-other' },
          models: [{ id: 'claude-sonnet-5' }],
          createdAt: 0,
        },
      ],
    });
    const h = harness(
      new InMemorySessionStore(),
      undefined,
      undefined,
      undefined,
      undefined,
      providers,
    );
    await h.engine.start();

    // This is how picking a model that belongs to another account reaches the daemon.
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: {
        kind: 'claude-code',
        cwd: '/repo',
        model: 'claude-sonnet-5',
        config: { accountId: 'acc_pinned' },
      },
    });
    await h.inject({ kind: 'session.list', clientReqId: 'r2' });

    expect(listedSessions(h.sent, 'r2')[0]?.accountId).toBe('acc_pinned');
  });
});

describe('a session keeps its own pick', () => {
  it('resumes on the run’s account and model after the daemon default moved', async () => {
    const providers = new InMemoryProviderConfigStore();
    providers.update({
      providers: {
        'claude-code': { enabled: true, activeAccountId: 'acc_first', model: 'model-first' },
      },
      accounts: [
        {
          id: 'acc_first',
          label: 'First',
          service: 'anthropic-api',
          credential: { type: 'api-key', key: 'sk-first' },
          models: [{ id: 'model-first' }],
          createdAt: 0,
        },
        {
          id: 'acc_second',
          label: 'Second',
          service: 'anthropic-api',
          credential: { type: 'api-key', key: 'sk-second' },
          models: [{ id: 'model-second' }],
          createdAt: 0,
        },
      ],
    });
    const store = new InMemorySessionStore();
    const h = harness(store, undefined, undefined, undefined, undefined, providers);
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    h.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    await tick();
    await h.inject({ kind: 'session.stop', clientReqId: 'r2', sessionId });

    // Settings moves the agent's default to the other account while the thread sleeps.
    providers.update({
      providers: {
        'claude-code': { enabled: true, activeAccountId: 'acc_second', model: 'model-second' },
      },
    });
    await h.inject({ kind: 'session.resume', clientReqId: 'r3', sessionId });

    const resumed = nullthrow(h.adapters.at(-1));
    expect(resumed.resumedWith?.model).toBe('model-first');
    expect(resumed.resumedWith?.config?.apiKey).toBe('sk-first');
    expect((await store.load())[0].runs.at(-1)?.accountId).toBe('acc_first');
  });
});

class ResumelessAdapter extends FakeAdapter {
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: true,
    resume: false,
  };
}

describe('live account switching', () => {
  /** Two accounts an agent can bind, one of them currently bound. */
  function twoAccountStore(): InMemoryProviderConfigStore {
    const providers = new InMemoryProviderConfigStore();
    providers.update({
      providers: {
        'claude-code': { enabled: true, activeAccountId: 'acc_first', model: 'model-first' },
      },
      accounts: [
        {
          id: 'acc_first',
          label: 'First',
          service: 'anthropic-api',
          credential: { type: 'api-key', key: 'sk-first' },
          models: [{ id: 'model-first' }],
          createdAt: 0,
        },
        {
          id: 'acc_second',
          label: 'Second',
          service: 'anthropic-api',
          credential: { type: 'api-key', key: 'sk-second' },
          models: [{ id: 'model-second' }],
          createdAt: 0,
        },
      ],
    });
    return providers;
  }

  async function liveSession(
    makeAdapter?: () => FakeAdapter,
    options: { withTranscript?: boolean } = {},
  ) {
    const { withTranscript = true } = options;
    const store = new InMemorySessionStore();
    const h = harness(store, makeAdapter, undefined, undefined, undefined, twoAccountStore());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    if (withTranscript) {
      h.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-live') });
      await tick();
    }
    return { ...h, store, sessionId };
  }

  function switchTo(
    h: Awaited<ReturnType<typeof liveSession>>,
    accountId: string,
    model: string,
    clientReqId = 'switch',
  ) {
    return h.inject({
      kind: 'agent.input',
      clientReqId,
      sessionId: h.sessionId,
      input: { type: 'set-model', model, accountId },
    });
  }

  it('relaunches on the new account, resuming the transcript under the same id', async () => {
    const h = await liveSession();

    await switchTo(h, 'acc_second', 'model-second');

    expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'switch' });
    // A fresh adapter, resumed from the transcript the old one had established.
    expect(h.adapters).toHaveLength(2);
    expect(h.adapters[0].stopped).toBe(true);
    expect(h.adapters[1].resumedFrom).toBe('native-live');
    expect(h.adapters[1].resumedWith?.model).toBe('model-second');
    expect(h.adapters[1].resumedWith?.config?.apiKey).toBe('sk-second');

    const runs = (await h.store.load())[0].runs;
    expect(runs).toHaveLength(2);
    expect(runs[1].accountId).toBe('acc_second');

    await h.inject({ kind: 'session.list', clientReqId: 'listed' });
    expect(listedSessions(h.sent, 'listed')[0]?.accountId).toBe('acc_second');
  });

  it('forwards a pick on the session’s own account in place, recording no new run', async () => {
    const h = await liveSession();

    await switchTo(h, 'acc_first', 'model-first');

    expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'switch' });
    expect(h.adapters).toHaveLength(1);
    expect(h.adapters[0].sentInputs).toContainEqual({
      type: 'set-model',
      model: 'model-first',
      accountId: 'acc_first',
    });
    expect((await h.store.load())[0].runs).toHaveLength(1);
  });

  it('refuses a switch while a turn is running', async () => {
    const h = await liveSession();
    h.adapters[0].emit({ type: 'status', status: 'running' });
    await tick();

    await switchTo(h, 'acc_second', 'model-second');

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'switch',
      code: 'conflict',
      message: 'The session is busy; switch accounts once the turn has finished',
    });
    expect(h.adapters).toHaveLength(1);
  });

  it('refuses a switch on a session with no provider transcript rather than starting fresh', async () => {
    const h = await liveSession(undefined, { withTranscript: false });

    await switchTo(h, 'acc_second', 'model-second');

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'switch',
      code: 'conflict',
      message: 'The session has no provider transcript to carry to another account',
    });
    expect(h.adapters).toHaveLength(1);
  });

  it('refuses before teardown when the agent cannot resume, leaving the session live', async () => {
    const h = await liveSession(() => new ResumelessAdapter());

    await switchTo(h, 'acc_second', 'model-second');

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'switch',
      code: 'unsupported',
      message: 'claude-code: switching account needs history resume, which it does not support',
    });
    // The whole point of checking first: the session it refused to move is still running.
    expect(h.adapters).toHaveLength(1);
    expect(h.adapters[0].stopped).toBe(false);
  });
});
