import type { AgentEvent, WirePayload } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { describe, expect, it } from 'vitest';
import {
  createSessionHarness as harness,
  startedSessionId as startedId,
} from './fixtures/session-harness';

const QUESTION_ASK: AgentEvent = {
  type: 'question-request',
  requestId: 'ask-1',
  toolCall: { toolCallId: 't1', title: 'AskUserQuestion' },
  questions: [
    {
      questionId: 'q0',
      prompt: 'Which one?',
      multiSelect: false,
      options: [
        { optionId: 'o0', label: 'A' },
        { optionId: 'o1', label: 'B' },
      ],
    },
  ],
};

const PERMISSION_ASK: AgentEvent = {
  type: 'permission-request',
  requestId: 'perm-1',
  toolCall: { toolCallId: 't2', title: 'Run' },
  options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }],
};

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

describe('engine session attach', () => {
  it('replays the live status and open asks to an attaching client', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(PERMISSION_ASK);
    adapter.emit(QUESTION_ASK);

    const mark = sent.length;
    await inject({ kind: 'session.attach', sessionId });
    const replayed = eventsAfter(sent, mark);
    expect(replayed[0]).toEqual({ type: 'status', status: 'running' });
    expect(replayed).toContainEqual(PERMISSION_ASK);
    expect(replayed).toContainEqual(QUESTION_ASK);
  });

  it('replays the latest command catalog to an attaching client', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'available-commands-update', commands: [{ name: 'stale' }] });
    adapter.emit({
      type: 'available-commands-update',
      commands: [{ name: 'compact', description: 'Compact the context' }],
    });

    const mark = sent.length;
    await inject({ kind: 'session.attach', sessionId });
    const catalogs = eventsAfter(sent, mark).filter((e) => e.type === 'available-commands-update');
    // Full-replace semantics: only the latest catalog is replayed.
    expect(catalogs).toEqual([
      {
        type: 'available-commands-update',
        commands: [{ name: 'compact', description: 'Compact the context' }],
      },
    ]);
  });

  it('replays the latest model catalog to an attaching client', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'available-models-update', models: [{ id: 'stale/old', label: 'Old' }] });
    adapter.emit({
      type: 'available-models-update',
      models: [
        {
          id: 'gpt-5.6-sol',
          label: 'GPT-5.6-Sol',
          effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
          defaultEffort: 'low',
        },
      ],
    });

    const mark = sent.length;
    await inject({ kind: 'session.attach', sessionId });
    const catalogs = eventsAfter(sent, mark).filter((e) => e.type === 'available-models-update');
    // Full-replace semantics: only the latest catalog is replayed.
    expect(catalogs).toEqual([
      {
        type: 'available-models-update',
        models: [
          {
            id: 'gpt-5.6-sol',
            label: 'GPT-5.6-Sol',
            effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
            defaultEffort: 'low',
          },
        ],
      },
    ]);
  });

  it('replays the latest adapter capabilities to an attaching client', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({
      type: 'capabilities-update',
      capabilities: { slashCommands: true, shellCommand: false },
    });

    const mark = sent.length;
    await inject({ kind: 'session.attach', sessionId });
    expect(eventsAfter(sent, mark)).toContainEqual({
      type: 'capabilities-update',
      capabilities: { slashCommands: true, shellCommand: false },
    });
  });
});
