import { asHistoryId } from '@linkcode/agent-adapter';
import type { RunId, SessionId, SessionRecord } from '@linkcode/schema';
import { Effect } from 'effect';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { SessionRecordRegistry } from '../session/session-record-registry';
import { InMemorySessionStore } from '../session/session-store';

const sessionId = 'sess-registry' as SessionId;

function makeRecord(): SessionRecord {
  return {
    sessionId,
    kind: 'claude-code',
    cwd: '/repo',
    origin: { type: 'created' },
    createdAt: 1,
    updatedAt: 1,
    runs: [],
    graphRevision: 0,
  };
}

async function startedRegistry() {
  const registry = new SessionRecordRegistry(new InMemorySessionStore(), noop);
  await Effect.runPromise(
    registry.start((effect) => {
      void Effect.runPromise(effect);
    }),
  );
  registry.register(makeRecord());
  return registry;
}

describe('session record registry run addressing', () => {
  it('seals the addressed run, not the newest one', async () => {
    const registry = await startedRegistry();
    const first = registry.beginRun(sessionId);
    const second = registry.beginRun(sessionId);

    registry.sealRun(sessionId, first);

    const runs = registry.get(sessionId)?.runs ?? [];
    expect(runs.find((run) => run.runId === first)?.endedAt).toBeTypeOf('number');
    expect(runs.find((run) => run.runId === second)?.endedAt).toBeUndefined();
  });

  it('binds a history id to the addressed run while a newer run exists', async () => {
    const registry = await startedRegistry();
    const first = registry.beginRun(sessionId);
    const second = registry.beginRun(sessionId);

    registry.bindHistoryId(sessionId, first, asHistoryId('native-old'));

    const runs = registry.get(sessionId)?.runs ?? [];
    expect(runs.find((run) => run.runId === first)?.historyId).toBe('native-old');
    expect(runs.find((run) => run.runId === second)?.historyId).toBeUndefined();
  });

  it('reports only the newest run as current', async () => {
    const registry = await startedRegistry();
    const first = registry.beginRun(sessionId);
    const second = registry.beginRun(sessionId);

    expect(registry.isCurrentRun(sessionId, first)).toBe(false);
    expect(registry.isCurrentRun(sessionId, second)).toBe(true);
    expect(registry.isCurrentRun(sessionId, 'run-unknown' as RunId)).toBe(false);
  });

  it('adopts a caller-minted run id', async () => {
    const registry = await startedRegistry();
    const minted = 'run-preminted' as RunId;

    expect(registry.beginRun(sessionId, { runId: minted })).toBe(minted);
    expect(registry.get(sessionId)?.runs.at(-1)?.runId).toBe(minted);
  });
});
