import { asHistoryId } from '@linkcode/agent-adapter';
import type { RunId, SessionId, SessionRecord } from '@linkcode/schema';
import { Effect } from 'effect';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
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
    eventEpoch: 0,
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

  it('resolves the thread history past an abandoned run', async () => {
    const registry = await startedRegistry();
    const first = registry.beginRun(sessionId);
    registry.bindHistoryId(sessionId, first, asHistoryId('native-1'));
    const second = registry.beginRun(sessionId);
    registry.bindHistoryId(sessionId, second, asHistoryId('native-child'));

    registry.abandonRun(sessionId, second);

    expect(registry.historyId(sessionId)).toBe('native-1');
    expect(registry.get(sessionId)?.runs.find((run) => run.runId === second)).toMatchObject({
      historyId: 'native-child',
      abandonedAt: expect.any(Number),
      endedAt: expect.any(Number),
    });
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

describe('session record registry event epoch', () => {
  it('bumps the epoch on every run launch', async () => {
    const registry = await startedRegistry();
    expect(registry.get(sessionId)?.eventEpoch).toBe(0);

    registry.beginRun(sessionId);
    expect(registry.get(sessionId)?.eventEpoch).toBe(1);
    registry.beginRun(sessionId);
    expect(registry.get(sessionId)?.eventEpoch).toBe(2);
  });

  it('bumps every loaded record at boot and persists the bump on the next launch', async () => {
    const store = new InMemorySessionStore();
    await store.save({ ...makeRecord(), eventEpoch: 5 });
    const registry = new SessionRecordRegistry(store, noop);
    await Effect.runPromise(
      registry.start((effect) => {
        void Effect.runPromise(effect);
      }),
    );

    // In memory immediately: a relaunch after a reboot can never reuse a pre-reboot epoch.
    expect(registry.get(sessionId)?.eventEpoch).toBe(6);

    registry.beginRun(sessionId);
    await wait(0);
    const persisted = await store.load();
    expect(persisted[0]?.eventEpoch).toBe(7);
  });
});
