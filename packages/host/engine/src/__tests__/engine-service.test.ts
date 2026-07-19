import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InstalledAsset, ValidatedWireMessage, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect, Logger as EffectLogger, Layer, ManagedRuntime } from 'effect';
import { asyncNoop, noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import type { TranslatorService } from '../agent/translator';
import type { AssetService } from '../asset/service';
import { InMemoryLoopStore } from '../automation/loop-store';
import { InMemoryScheduleStore } from '../automation/schedule-store';
import { createEngineRuntime } from '../engine';
import { EngineService, makeEngineLayer } from '../service';
import type { SessionStore } from '../session/session-store';
import { InMemorySessionStore } from '../session/session-store';
import type { PtyBackend } from '../terminal/pty-backend';
import type { WorkspaceStore } from '../workspace/workspace-store';
import { InMemoryWorkspaceStore } from '../workspace/workspace-store';
import { FakeAdapter } from './fixtures/session-harness';

describe('engine service', () => {
  it('owns the engine lifecycle and exposes workspace orchestration', async () => {
    let connects = 0;
    let closes = 0;
    const transport: Transport = {
      connect() {
        connects += 1;
        return Promise.resolve();
      },
      send(message) {
        void message;
      },
      onMessage() {
        return noop;
      },
      onClose() {
        return noop;
      },
      close() {
        closes += 1;
      },
    };
    const runtime = ManagedRuntime.make(makeEngineLayer(transport));
    const root = await mkdtemp(join(tmpdir(), 'linkcode-engine-service-'));
    const chatRoot = join(root, 'chat');

    try {
      const engine = await runtime.runPromise(Effect.service(EngineService));
      const workspace = await runtime.runPromise(engine.ensureChatWorkspace(chatRoot));

      expect(connects).toBe(1);
      expect(workspace.cwd).toBe(chatRoot);
    } finally {
      await runtime.dispose();
      await rm(root, { recursive: true, force: true });
    }

    expect(closes).toBe(1);
  });

  it('recovers durable state before connecting and releases the transport last', async () => {
    const events: string[] = [];
    const sessions = new InMemorySessionStore();
    const workspaces = new InMemoryWorkspaceStore();
    const schedules = new InMemoryScheduleStore();
    const loops = new InMemoryLoopStore();
    const sessionLoad = sessions.load.bind(sessions);
    const workspaceLoad = workspaces.load.bind(workspaces);
    const scheduleLoad = schedules.load.bind(schedules);
    const runningScheduleLoad = schedules.loadRunningRuns.bind(schedules);
    const loopLoad = loops.load.bind(loops);
    const runningLoopLoad = loops.loadRunning.bind(loops);
    const unsubscribeTransport = vi.fn();
    vi.spyOn(sessions, 'load').mockImplementation(() => {
      events.push('sessions.load');
      return sessionLoad();
    });
    vi.spyOn(workspaces, 'load').mockImplementation(() => {
      events.push('workspaces.load');
      return workspaceLoad();
    });
    vi.spyOn(schedules, 'load').mockImplementation(() => {
      events.push('schedules.load');
      return scheduleLoad();
    });
    vi.spyOn(schedules, 'loadRunningRuns').mockImplementation(() => {
      events.push('schedule-runs.recover');
      return runningScheduleLoad();
    });
    vi.spyOn(loops, 'load').mockImplementation(() => {
      events.push('loops.load');
      return loopLoad();
    });
    vi.spyOn(loops, 'loadRunning').mockImplementation(() => {
      events.push('loops.recover');
      return runningLoopLoad();
    });
    const ptyBackend: PtyBackend = {
      open() {
        return Promise.reject(new Error('not used'));
      },
      shutdown() {
        events.push('pty.shutdown');
      },
    };
    const translator: TranslatorService = {
      ensure() {
        return Promise.reject(new Error('not used'));
      },
      closeAll() {
        events.push('translator.close');
        return Promise.reject(new Error('translator shutdown failed'));
      },
    };
    const transport: Transport = {
      connect() {
        events.push('transport.connect');
        return Promise.resolve();
      },
      send: noop,
      onMessage: () => unsubscribeTransport,
      onClose: () => noop,
      close() {
        expect(unsubscribeTransport).toHaveBeenCalledOnce();
        events.push('transport.close');
      },
    };
    const engineLayer = makeEngineLayer(transport, {
      sessionStore: sessions,
      workspaceStore: workspaces,
      scheduleStore: schedules,
      loopStore: loops,
      ptyBackend,
      translator,
    }).pipe(Layer.provide(EffectLogger.layer([EffectLogger.make(noop)])));
    const runtime = ManagedRuntime.make(engineLayer);

    await runtime.runPromise(Effect.service(EngineService));
    await runtime.dispose();

    expect(events).toEqual([
      'sessions.load',
      'workspaces.load',
      'schedules.load',
      'schedule-runs.recover',
      'loops.load',
      'loops.recover',
      'transport.connect',
      'pty.shutdown',
      'translator.close',
      'transport.close',
    ]);
  });

  it('releases partially started resources when transport connection fails', async () => {
    const events: string[] = [];
    const ptyBackend: PtyBackend = {
      open() {
        return Promise.reject(new Error('not used'));
      },
      shutdown() {
        events.push('pty.shutdown');
      },
    };
    const translator: TranslatorService = {
      ensure() {
        return Promise.reject(new Error('not used'));
      },
      closeAll() {
        events.push('translator.close');
        return Promise.resolve();
      },
    };
    const transport: Transport = {
      connect() {
        events.push('transport.connect');
        return Promise.reject(new Error('socket unavailable'));
      },
      send: noop,
      onMessage: () => noop,
      onClose: () => noop,
      close() {
        events.push('transport.close');
      },
    };
    const runtime = ManagedRuntime.make(makeEngineLayer(transport, { ptyBackend, translator }));

    try {
      await expect(runtime.runPromise(Effect.service(EngineService))).rejects.toMatchObject({
        _tag: 'OperationError',
        subsystem: 'transport',
        operation: 'transport.connect',
      });

      expect(events).toEqual([
        'transport.connect',
        'pty.shutdown',
        'translator.close',
        'transport.close',
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it('fails before connecting when session records cannot load', async () => {
    const connect = vi.fn(asyncNoop);
    const sessionStore: SessionStore = {
      load: () => Promise.reject(new Error('private database detail')),
      save: asyncNoop,
      delete: asyncNoop,
    };
    const transport: Transport = {
      connect,
      send: noop,
      onMessage: () => noop,
      onClose: () => noop,
      close: noop,
    };
    const runtime = ManagedRuntime.make(makeEngineLayer(transport, { sessionStore }));

    try {
      await expect(runtime.runPromise(Effect.service(EngineService))).rejects.toMatchObject({
        _tag: 'OperationError',
        subsystem: 'store',
        operation: 'session-records.load',
        publicMessage: 'Failed to load session records',
      });
      expect(connect).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });

  it('direct stop rejects late requests and interrupts accepted requests without replying', async () => {
    const sent: WirePayload[] = [];
    const unsubscribe = vi.fn();
    let handler: ((message: ValidatedWireMessage) => void) | undefined;
    let markEnsureStarted: () => void = noop;
    let settleEnsure: (asset: InstalledAsset) => void = noop;
    const ensureStarted = new Promise<void>((resolve) => {
      markEnsureStarted = resolve;
    });
    const pendingEnsure = new Promise<InstalledAsset>((resolve) => {
      settleEnsure = resolve;
    });
    const ensure = vi.fn(() => {
      markEnsureStarted();
      return pendingEnsure;
    });
    const assets: AssetService = {
      statuses: () => [],
      ensure,
      subscribe: () => noop,
    };
    const transport: Transport = {
      connect: asyncNoop,
      send(message) {
        sent.push(message.payload);
      },
      onMessage(callback) {
        handler = callback;
        return unsubscribe;
      },
      onClose: () => noop,
      close: noop,
    };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* createEngineRuntime(transport, { assets });
          yield* engine.start;
          const inject = (clientReqId: string): void => {
            handler?.(createWireMessage({ kind: 'asset.ensure', clientReqId, id: 'agent:codex' }));
          };

          inject('accepted');
          yield* Effect.promise(() => ensureStarted);
          yield* engine.stop;

          expect(unsubscribe).toHaveBeenCalledOnce();
          expect(sent).toEqual([]);
          inject('late');
          expect(ensure).toHaveBeenCalledOnce();

          settleEnsure({ id: 'agent:codex', version: '1.0.0', path: '/bin/codex' });
          yield* Effect.yieldNow;
          expect(sent).toEqual([]);
        }),
      ),
    );
  });

  it('direct stop prevents an accepted session start from registering after the shutdown sweep', async () => {
    const sent: WirePayload[] = [];
    let handler: ((message: ValidatedWireMessage) => void) | undefined;
    let markSaveStarted: () => void = noop;
    let settleSave: () => void = noop;
    const saveStarted = new Promise<void>((resolve) => {
      markSaveStarted = resolve;
    });
    const pendingSave = new Promise<void>((resolve) => {
      settleSave = resolve;
    });
    const save = vi.fn(() => {
      markSaveStarted();
      return pendingSave;
    });
    const workspaceStore: WorkspaceStore = {
      load: () => Promise.resolve([]),
      save,
      delete: asyncNoop,
    };
    const factory = vi.fn(() => new FakeAdapter());
    const transport: Transport = {
      connect: asyncNoop,
      send(message) {
        sent.push(message.payload);
      },
      onMessage(callback) {
        handler = callback;
        return noop;
      },
      onClose: () => noop,
      close: noop,
    };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* createEngineRuntime(transport, { factory, workspaceStore });
          yield* engine.start;
          handler?.(
            createWireMessage({
              kind: 'session.start',
              clientReqId: 'start',
              opts: { kind: 'claude-code', cwd: '/repo' },
            }),
          );
          yield* Effect.promise(() => saveStarted);

          yield* engine.stop;
          expect(save).toHaveBeenCalledOnce();
          expect(factory).not.toHaveBeenCalled();
          expect(sent).toEqual([]);

          settleSave();
          yield* Effect.yieldNow;
          expect(factory).not.toHaveBeenCalled();
          expect(sent).toEqual([]);
        }),
      ),
    );
  });
});
