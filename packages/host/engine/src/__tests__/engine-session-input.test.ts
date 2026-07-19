import type { AgentEvent, AgentInput, WirePayload } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
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
    expect(echoes).toEqual([
      { type: 'user-message', content: [{ type: 'text', text: '/review src/index.ts' }] },
      { type: 'user-message', content: [{ type: 'text', text: '$ git status' }] },
    ]);
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
    expect(echoes).toEqual([{ type: 'user-message', content: [{ type: 'text', text: '/cost' }] }]);
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
    expect(rejected.filter((payload) => payload.kind === 'request.failed')).toHaveLength(2);
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

    await h.inject({
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
