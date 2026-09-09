import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentEvent,
  ConversationWatermark,
  MessageId,
  RunId,
  SessionId,
  SessionRecord,
  StartOptions,
  ValidatedWireMessage,
  WirePayload,
} from '@linkcode/schema';
import { compareConversationWatermarks, OperationIdSchema } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Deferred, Effect, Scope } from 'effect';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { AgentRuntimeService } from '../agent/runtime-service';
import { InMemoryAttachmentStore } from '../attachment/attachment-store';
import { FsBlobStore } from '../attachment/blob-store';
import { InMemoryConversationStore } from '../conversation/conversation-store';
import { ConversationLiveJournals } from '../conversation/live-journal';
import { ConversationTurnService } from '../conversation/turn-service';
import type { OperationError } from '../failure';
import { FileHostService } from '../preview/file-host-service';
import { PreviewRouteRegistry } from '../preview/route-registry';
import { InMemoryResourceStore } from '../resource/resource-store';
import { ResourceService } from '../resource/service';
import { LiveSession } from '../session/live-session';
import { SessionEventProcessor } from '../session/session-event-processor';
import { SessionRecordRegistry } from '../session/session-record-registry';
import { InMemorySessionStore } from '../session/session-store';
import {
  FakeAdapter,
  createSessionHarness as harness,
  startedSessionId as startedId,
} from './fixtures/session-harness';

function chunk(text: string): AgentEvent {
  return {
    type: 'agent-message-chunk',
    messageId: 'msg-seq' as MessageId,
    content: { type: 'text', text },
  };
}

interface StampedFrame {
  readonly epoch: number;
  readonly seq: number;
  readonly event: AgentEvent;
}

function stampedFrames(sent: WirePayload[], sessionId: SessionId): StampedFrame[] {
  return sent.flatMap((payload) => {
    if (payload.kind !== 'agent.event' || payload.sessionId !== sessionId) return [];
    expect(payload.runId).toBeDefined();
    expect(payload.epoch).toBeDefined();
    expect(payload.seq).toBeDefined();
    if (payload.epoch === undefined || payload.seq === undefined) return [];
    return [{ epoch: payload.epoch, seq: payload.seq, event: payload.event }];
  });
}

describe('agent.event sequencing over the wire', () => {
  it('stamps every frame with the run epoch and contiguous seqs', async () => {
    const h = harness();
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    const adapter = h.adapters[0];

    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(chunk('hello'));
    adapter.emit({ type: 'status', status: 'idle' });

    const frames = stampedFrames(h.sent, sessionId);
    expect(frames).toHaveLength(3);
    // A fresh record launches under epoch 0; seq is minted contiguously from 1.
    expect(frames.map(({ epoch, seq }) => [epoch, seq])).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
    ]);
  });

  it('bumps the epoch on relaunch so every old-run position compares below the new run', async () => {
    const h = harness();
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    h.adapters[0].emit(chunk('first epoch'));
    const before = stampedFrames(h.sent, sessionId);
    const oldStamp = before.at(-1);
    expect(oldStamp).toBeDefined();

    await h.inject({ kind: 'session.stop', clientReqId: 'r-stop', sessionId });
    const mark = h.sent.length;
    await h.inject({ kind: 'session.resume', clientReqId: 'r-resume', sessionId });
    h.adapters[1].emit(chunk('second epoch'));

    const after = stampedFrames(h.sent.slice(mark), sessionId);
    const newStamp = after.at(-1);
    expect(newStamp).toBeDefined();
    if (!oldStamp || !newStamp) return;
    expect(newStamp.epoch).toBeGreaterThan(oldStamp.epoch);
    expect(newStamp.seq).toBe(after.length);
    // The merge rule discards anything at or below a watermark: the whole old epoch sits below
    // position 0 of the new one, so a delayed old-run event can never fold over newer state.
    expect(compareConversationWatermarks(oldStamp, { epoch: newStamp.epoch, seq: 0 })).toBeLessThan(
      0,
    );
  });

  it('re-stamps the interactive-request replay on attach above any prior watermark', async () => {
    const h = harness();
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    h.adapters[0].emit({ type: 'status', status: 'running' });
    h.adapters[0].emit({
      type: 'permission-request',
      requestId: 'perm-replay',
      title: 'Run',
      subject: { type: 'tool-call', toolCallId: 't1' },
      options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }],
    });
    const original = stampedFrames(h.sent, sessionId).at(-1);
    expect(original?.event.type).toBe('permission-request');

    await h.inject({ kind: 'session.attach', sessionId });

    const frames = stampedFrames(h.sent, sessionId);
    const replayed = frames.filter(({ event }) => event.type === 'permission-request').at(-1);
    expect(replayed).toBeDefined();
    if (!original || !replayed) return;
    // The authoritative replay lands above every prior position, so a client merging by
    // watermark can never drop an open interactive request as already-seen.
    expect(compareConversationWatermarks(replayed, original)).toBeGreaterThan(0);
  });
});

/** Save log + on-demand failure: the launch path must prove the bumped epoch durable pre-mint. */
class GatedSaveStore extends InMemorySessionStore {
  failSaves = false;

  constructor(private readonly log: string[]) {
    super();
  }

  override save(record: SessionRecord): Promise<void> {
    if (this.failSaves) return Promise.reject(new Error('session store save failed'));
    this.log.push(`save:${record.eventEpoch}`);
    return super.save(record);
  }
}

class StartLoggingAdapter extends FakeAdapter {
  constructor(private readonly log: string[]) {
    super();
  }

  override start(opts: StartOptions): Promise<void> {
    this.log.push('adapter-start');
    return super.start(opts);
  }
}

describe('durable epoch before minting', () => {
  function launchHarness() {
    const log: string[] = [];
    const store = new GatedSaveStore(log);
    return { log, store, h: harness(store, () => new StartLoggingAdapter(log)) };
  }

  it('persists the bumped epoch before the relaunched adapter starts', async () => {
    const { log, h } = launchHarness();
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    await h.inject({ kind: 'session.stop', clientReqId: 'r-stop', sessionId });

    await h.inject({ kind: 'session.resume', clientReqId: 'r-resume', sessionId });

    const bumpedSave = log.indexOf('save:1');
    const relaunchStart = log.lastIndexOf('adapter-start');
    expect(bumpedSave).toBeGreaterThanOrEqual(0);
    expect(relaunchStart).toBeGreaterThan(bumpedSave);
  });

  it('fails the launch loud when the epoch cannot be made durable, minting nothing', async () => {
    const { store, h } = launchHarness();
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    await h.inject({ kind: 'session.stop', clientReqId: 'r-stop', sessionId });

    store.failSaves = true;
    const mark = h.sent.length;
    await h.inject({
      kind: 'turn.submit',
      clientReqId: 'r-sub',
      sessionId,
      operationId: OperationIdSchema.parse('op-epoch-flush'),
      input: { type: 'prompt', blocks: [{ type: 'text', text: 'hello' }] },
    });

    expect(h.sent.slice(mark)).toContainEqual(
      expect.objectContaining({ kind: 'request.failed', replyTo: 'r-sub' }),
    );
    // No LiveSession was constructed and nothing was minted under the undurable epoch.
    expect(h.adapters).toHaveLength(1);
    expect(stampedFrames(h.sent.slice(mark), sessionId)).toEqual([]);
  });
});

describe('stale-run events at saga cutover', () => {
  async function makeProcessor() {
    const sent: WirePayload[] = [];
    const transport: Transport = {
      connect: () => Promise.resolve(),
      send(msg: ValidatedWireMessage) {
        sent.push(msg.payload);
      },
      onMessage: () => noop,
      onClose: () => noop,
      close: noop,
    };
    const registry = new SessionRecordRegistry(new InMemorySessionStore(), noop);
    await Effect.runPromise(
      registry.start((effect) => {
        void Effect.runPromise(effect);
      }),
    );
    const runtimes = await Effect.runPromise(AgentRuntimeService.make({ onChanged: noop }, noop));
    const journals = new ConversationLiveJournals();
    const turns = new ConversationTurnService(
      new InMemoryConversationStore(),
      registry,
      transport,
      (effect) => {
        void Effect.runPromise(effect);
      },
    );
    const processor = new SessionEventProcessor(
      transport,
      registry,
      runtimes,
      noop,
      new ResourceService(
        transport,
        new InMemoryResourceStore(),
        registry,
        undefined,
        new FileHostService(new PreviewRouteRegistry()),
        new FsBlobStore(join(tmpdir(), 'linkcode-sequencing-blobs')),
        new InMemoryAttachmentStore(),
      ),
      turns,
      journals,
    );
    return { sent, registry, journals, processor };
  }

  function record(sessionId: SessionId): SessionRecord {
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

  async function liveSession(
    sessionId: SessionId,
    runId: RunId,
    epoch: number,
  ): Promise<LiveSession> {
    return Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const closed = yield* Deferred.make<void, OperationError>();
        return new LiveSession(new FakeAdapter(), sessionId, runId, epoch, scope, closed);
      }),
    );
  }

  it('drops a stale run session-scoped status at the source: no stopped flicker, nothing journaled', async () => {
    const { sent, registry, journals, processor } = await makeProcessor();
    const sessionId = 'sess-cutover' as SessionId;
    registry.register(record(sessionId));

    const staleRun = registry.beginRun(sessionId);
    const staleEpoch = registry.get(sessionId)?.eventEpoch ?? -1;
    const stale = await liveSession(sessionId, staleRun, staleEpoch);
    // The saga cut over: a new run is current while the old adapter still drains.
    const currentRun = registry.beginRun(sessionId);
    const currentEpoch = registry.get(sessionId)?.eventEpoch ?? -1;

    processor.handle(sessionId, stale, { type: 'status', status: 'stopped' });

    expect(sent.filter((payload) => payload.kind === 'agent.event')).toEqual([]);
    expect(journals.get(sessionId)).toBeUndefined();

    // The replacement's session-scoped events pass and stamp under the new epoch.
    const current = await liveSession(sessionId, currentRun, currentEpoch);
    processor.handle(sessionId, current, { type: 'status', status: 'running' });
    const frames = stampedFrames(sent, sessionId);
    expect(frames).toEqual([
      { epoch: currentEpoch, seq: 1, event: { type: 'status', status: 'running' } },
    ]);
  });

  it('passes a stale run turn-scoped straggler under its own epoch, provably below the new watermark', async () => {
    const { sent, registry, journals, processor } = await makeProcessor();
    const sessionId = 'sess-straggler' as SessionId;
    registry.register(record(sessionId));

    const staleRun = registry.beginRun(sessionId);
    const staleEpoch = registry.get(sessionId)?.eventEpoch ?? -1;
    const stale = await liveSession(sessionId, staleRun, staleEpoch);
    registry.beginRun(sessionId);
    const currentEpoch = registry.get(sessionId)?.eventEpoch ?? -1;

    processor.handle(sessionId, stale, chunk('late but attributed'));

    const frames = stampedFrames(sent, sessionId);
    expect(frames).toHaveLength(1);
    const stamp: ConversationWatermark = frames[0];
    expect(stamp.epoch).toBe(staleEpoch);
    // Any client watermark in the new epoch discards it — even at the epoch's very first position.
    expect(compareConversationWatermarks(stamp, { epoch: currentEpoch, seq: 0 })).toBeLessThan(0);
    // And the journal recorded exactly what went to the wire.
    expect(
      journals
        .get(sessionId)
        ?.snapshot()
        .map(({ epoch, seq }) => ({ epoch, seq })),
    ).toEqual([{ epoch: stamp.epoch, seq: stamp.seq }]);
  });
});
