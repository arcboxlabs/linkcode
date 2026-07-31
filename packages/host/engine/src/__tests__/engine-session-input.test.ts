import type {
  AgentEvent,
  AgentInput,
  SessionId,
  SessionResource,
  WirePayload,
} from '@linkcode/schema';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES, textBlock } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { InMemoryResourceStore } from '../resource/resource-store';
import { InMemorySessionStore } from '../session/session-store';
import {
  FakeAdapter,
  createSessionHarness as harness,
  startedSessionId as startedId,
} from './fixtures/session-harness';

class GatedSendAdapter extends FakeAdapter {
  releaseSend: () => void = noop;
  sendCount = 0;

  override send(_input: AgentInput): Promise<void> {
    this.sendCount += 1;
    return new Promise((resolve) => {
      this.releaseSend = resolve;
    });
  }
}

class RejectingTurnAdapter extends FakeAdapter {
  override send(input: AgentInput): Promise<void> {
    this.sentInputs.push(input);
    return Promise.reject(new Error('provider rejected input'));
  }
}

class RejectingListResourceStore extends InMemoryResourceStore {
  private rejectNextList = true;

  override list(sessionId: SessionId): Promise<SessionResource[]> {
    if (!this.rejectNextList) return super.list(sessionId);
    this.rejectNextList = false;
    return Promise.reject(new Error('resource database unavailable'));
  }
}

function eventsAfter(sent: WirePayload[], mark: number): AgentEvent[] {
  return sent.slice(mark).flatMap((p) => (p.kind === 'agent.event' ? [p.event] : []));
}

async function startedHarness() {
  const h = harness();
  await h.engine.start();
  await h.inject({
    kind: 'session.start',
    clientReqId: 'r1',
    opts: { kind: 'claude-code', cwd: '/repo' },
  });
  return { ...h, sessionId: startedId(h.sent, 'r1'), adapter: nullthrow(h.adapters[0]) };
}

describe('engine session input', () => {
  it('reports an unsupported attachment MIME type as an invalid request', async () => {
    const h = await startedHarness();

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'input',
      sessionId: h.sessionId,
      input: {
        type: 'prompt',
        content: [{ type: 'image', mimeType: 'image/svg+xml', data: 'AA==' }],
      },
    });

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'input',
      code: 'invalid_request',
      message: 'Unsupported image attachment type: image/svg+xml',
    });

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'valid-input',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [textBlock('valid')] },
    });
    expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'valid-input' });
  });

  it('reports an oversized attachment as a limit violation', async () => {
    const h = await startedHarness();

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'input',
      sessionId: h.sessionId,
      input: {
        type: 'prompt',
        content: [
          {
            type: 'image',
            mimeType: 'image/png',
            data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64'),
          },
        ],
      },
    });

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'input',
      code: 'limit_exceeded',
      message: 'Attachment exceeds the maximum allowed size',
    });
  });

  it('reports oversized aggregate attachments as a limit violation', async () => {
    const h = await startedHarness();
    const half = MAX_ATTACHMENT_TOTAL_BYTES / 2;

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'input',
      sessionId: h.sessionId,
      input: {
        type: 'prompt',
        content: [
          { type: 'image', mimeType: 'image/png', data: Buffer.alloc(half).toString('base64') },
          {
            type: 'image',
            mimeType: 'image/png',
            data: Buffer.alloc(half + 3).toString('base64'),
          },
        ],
      },
    });

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'input',
      code: 'limit_exceeded',
      message: 'Attachments exceed the maximum allowed total size',
    });
  });

  it('echoes command and shell inputs as the text the user typed', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({
      type: 'capabilities-update',
      capabilities: { slashCommands: true, shellCommand: true },
    });
    adapter.emit({ type: 'available-commands-update', commands: [{ name: 'review' }] });
    const mark = sent.length;
    await inject({
      kind: 'agent.input',
      clientReqId: 'r-cmd',
      sessionId,
      input: { type: 'command', name: 'review', arguments: 'src/index.ts' },
    });
    await inject({
      kind: 'agent.input',
      clientReqId: 'r-sh',
      sessionId,
      input: { type: 'shell-command', command: 'git status' },
    });
    const echoes = eventsAfter(sent, mark).filter((e) => e.type === 'user-message');
    expect(echoes).toMatchObject([
      { type: 'user-message', content: [{ type: 'text', text: '/review src/index.ts' }] },
      { type: 'user-message', content: [{ type: 'text', text: '$ git status' }] },
    ]);
    expect(new Set(echoes.map((event) => event.messageId)).size).toBe(2);
  });

  it('accepts a command invoked by a catalog alias, echoing the typed alias', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({
      type: 'capabilities-update',
      capabilities: { slashCommands: true, shellCommand: false },
    });
    adapter.emit({
      type: 'available-commands-update',
      commands: [{ name: 'usage', aliases: ['cost'] }],
    });
    const mark = sent.length;
    await inject({
      kind: 'agent.input',
      clientReqId: 'r-alias',
      sessionId,
      input: { type: 'command', name: 'cost' },
    });
    const echoes = eventsAfter(sent, mark).filter((e) => e.type === 'user-message');
    expect(echoes).toMatchObject([
      { type: 'user-message', content: [{ type: 'text', text: '/cost' }] },
    ]);
    expect(echoes[0]?.messageId).toBeTruthy();
    expect(sent.slice(mark).some((payload) => payload.kind === 'request.failed')).toBe(false);
  });

  it('rejects unavailable command and shell inputs before echoing them', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({
      type: 'capabilities-update',
      capabilities: { slashCommands: true, shellCommand: false },
    });
    adapter.emit({ type: 'available-commands-update', commands: [{ name: 'compact' }] });
    const mark = sent.length;

    await inject({
      kind: 'agent.input',
      clientReqId: 'r-command',
      sessionId,
      input: { type: 'command', name: 'stale' },
    });
    await inject({
      kind: 'agent.input',
      clientReqId: 'r-shell',
      sessionId,
      input: { type: 'shell-command', command: 'git status' },
    });

    const rejected = sent.slice(mark);
    expect(
      rejected.some(
        (payload) => payload.kind === 'agent.event' && payload.event.type === 'user-message',
      ),
    ).toBe(false);
    expect(
      rejected.filter(
        (payload) =>
          payload.kind === 'agent.event' &&
          payload.event.type === 'error' &&
          payload.event.code === 'input_rejected',
      ),
    ).toHaveLength(2);
    expect(rejected.filter((payload) => payload.kind === 'request.failed')).toMatchObject([
      { reportedInConversation: true },
      { reportedInConversation: true },
    ]);
  });

  it('marks an adapter-rejected turn as already reported in the conversation', async () => {
    const h = harness(new InMemorySessionStore(), () => new RejectingTurnAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'input',
      sessionId,
      input: { type: 'prompt', content: [textBlock('hello')] },
    });

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'input',
      code: 'operation_failed',
      message: 'Agent input was rejected',
      reportedInConversation: true,
    });
    expect(h.sent).toContainEqual({
      kind: 'agent.event',
      sessionId,
      event: {
        type: 'error',
        message: 'Agent input was rejected',
        code: 'input_rejected',
        recoverable: true,
      },
    });
  });

  it('does not leave the turn busy when source lookup fails', async () => {
    const h = harness(
      new InMemorySessionStore(),
      () => new FakeAdapter(),
      undefined,
      undefined,
      undefined,
      undefined,
      { resourceStore: new RejectingListResourceStore() },
    );
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'start',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'start');

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'failed-input',
      sessionId,
      input: { type: 'prompt', content: [textBlock('first')] },
    });
    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'failed-input',
      code: 'operation_failed',
      message: 'Resource operation failed',
    });

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'retry-input',
      sessionId,
      input: { type: 'prompt', content: [textBlock('second')] },
    });
    expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'retry-input' });
    expect(h.adapters[0]?.sentInputs).toEqual([{ type: 'prompt', content: [textBlock('second')] }]);
  });

  it('rejects a concurrent turn input before echoing or dispatching it', async () => {
    const h = harness(new InMemorySessionStore(), () => new GatedSendAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    const adapter = nullthrow(h.adapters[0]) as GatedSendAdapter;

    void h.inject({
      kind: 'agent.input',
      clientReqId: 'r-first',
      sessionId,
      input: { type: 'prompt', content: [textBlock('first')] },
    });
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'r-second',
      sessionId,
      input: { type: 'prompt', content: [textBlock('second')] },
    });

    expect(adapter.sendCount).toBe(1);
    expect(
      h.sent.filter(
        (payload) => payload.kind === 'agent.event' && payload.event.type === 'user-message',
      ),
    ).toHaveLength(1);
    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r-second',
      code: 'conflict',
      message: `Session is busy: ${sessionId}`,
      reportedInConversation: true,
    });
    expect(h.sent).toContainEqual({
      kind: 'agent.event',
      sessionId,
      event: {
        type: 'error',
        message: `Session is busy: ${sessionId}`,
        code: 'input_rejected',
        recoverable: true,
      },
    });
    adapter.releaseSend();
  });
});
