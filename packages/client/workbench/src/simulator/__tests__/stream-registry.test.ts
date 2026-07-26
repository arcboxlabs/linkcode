import type { SessionId } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorStreamClient, SimulatorStreamOptions } from '../stream-registry';
import {
  acquireSimulatorStream,
  peekSimulatorStream,
  setSimulatorStreamOptions,
} from '../stream-registry';

interface FakeClient extends SimulatorStreamClient {
  started: Array<{ sessionId: SessionId; udid: string; options: SimulatorStreamOptions }>;
  stopped: Array<{ sessionId: SessionId; udid: string }>;
  failNextStart: boolean;
}

const OPTS: SimulatorStreamOptions = { fps: 60, scale: 1, codec: 'h264' };

function createFakeClient(): FakeClient {
  const started: Array<{ sessionId: SessionId; udid: string; options: SimulatorStreamOptions }> =
    [];
  const stopped: Array<{ sessionId: SessionId; udid: string }> = [];
  return {
    started,
    stopped,
    failNextStart: false,
    simulatorStreamStart(this: FakeClient, sessionId, udid, options) {
      if (this.failNextStart) {
        this.failNextStart = false;
        return Promise.reject(new Error('conflict'));
      }
      started.push({ sessionId, udid, options: options as SimulatorStreamOptions });
      return Promise.resolve({
        fps: options?.fps ?? 60,
        scale: options?.scale ?? 1,
        codec: options?.codec ?? ('h264' as const),
      });
    },
    simulatorStreamStop(sessionId, udid) {
      stopped.push({ sessionId, udid });
      return Promise.resolve({ ok: true });
    },
  };
}

const S1 = 'session-1' as SessionId;
const S2 = 'session-2' as SessionId;

describe('simulator stream registry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts one stream per device and stops it after the last release', async () => {
    const client = createFakeClient();
    const lease = acquireSimulatorStream(client, 'U-1', S1, OPTS);
    expect(lease.getSnapshot().phase).toBe('starting');
    await vi.advanceTimersByTimeAsync(0);
    expect(lease.getSnapshot().phase).toBe('streaming');
    expect(client.started).toMatchObject([{ sessionId: S1, udid: 'U-1', options: OPTS }]);

    lease.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.stopped).toEqual([{ sessionId: S1, udid: 'U-1' }]);
    expect(peekSimulatorStream(client, 'U-1')).toBeNull();
  });

  it('shares the entry across a release/acquire handoff and keeps the owner session', async () => {
    const client = createFakeClient();
    const first = acquireSimulatorStream(client, 'U-1', S1, OPTS);
    await vi.advanceTimersByTimeAsync(0);

    // Docked → maximized remount, meanwhile the active thread switched to another session.
    first.release();
    const second = acquireSimulatorStream(client, 'U-1', S2, OPTS);
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.started).toHaveLength(1);
    expect(client.stopped).toEqual([]);
    // The claim holder stays the session that started the stream.
    expect(second.getSnapshot().sessionId).toBe(S1);

    second.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.stopped).toEqual([{ sessionId: S1, udid: 'U-1' }]);
  });

  it('surfaces a failed start and restarts on demand', async () => {
    const client = createFakeClient();
    client.failNextStart = true;
    const lease = acquireSimulatorStream(client, 'U-1', S1, OPTS);
    const phases: string[] = [];
    lease.subscribe(() => phases.push(lease.getSnapshot().phase));
    await vi.advanceTimersByTimeAsync(0);
    expect(lease.getSnapshot().phase).toBe('failed');

    lease.restart();
    await vi.advanceTimersByTimeAsync(0);
    expect(lease.getSnapshot().phase).toBe('streaming');
    expect(phases).toEqual(['failed', 'starting', 'streaming']);
    lease.release();
    await vi.advanceTimersByTimeAsync(1000);
  });

  it('restarts a live stream with new options and no-ops on an unchanged retune', async () => {
    const client = createFakeClient();
    const lease = acquireSimulatorStream(client, 'U-1', S1, OPTS);
    const phases: string[] = [];
    lease.subscribe(() => phases.push(lease.getSnapshot().phase));
    await vi.advanceTimersByTimeAsync(0);
    expect(lease.getSnapshot().phase).toBe('streaming');

    // Same options: no stop/start.
    setSimulatorStreamOptions(client, 'U-1', OPTS);
    expect(client.stopped).toEqual([]);
    expect(client.started).toHaveLength(1);

    // Changed options: stop then restart, and the new stream carries them.
    const next: SimulatorStreamOptions = { fps: 30, scale: 0.5, codec: 'jpeg' };
    setSimulatorStreamOptions(client, 'U-1', next);
    expect(lease.getSnapshot().phase).toBe('starting');
    await vi.advanceTimersByTimeAsync(0);
    expect(lease.getSnapshot().phase).toBe('streaming');
    expect(client.stopped).toEqual([{ sessionId: S1, udid: 'U-1' }]);
    expect(client.started).toHaveLength(2);
    expect(client.started[1].options).toEqual(next);
    expect(phases).toEqual(['streaming', 'starting', 'streaming']);

    lease.release();
    await vi.advanceTimersByTimeAsync(1000);
  });

  it('ignores a stale start resolution after the entry was released', async () => {
    const client = createFakeClient();
    let resolveStart: () => void = noop;
    client.simulatorStreamStart = () =>
      new Promise((resolve) => {
        resolveStart = () => resolve({ fps: 30, scale: 0.5, codec: 'h264' });
      });
    const lease = acquireSimulatorStream(client, 'U-1', S1, OPTS);
    lease.release();
    await vi.advanceTimersByTimeAsync(1000);
    resolveStart();
    await vi.advanceTimersByTimeAsync(0);
    expect(peekSimulatorStream(client, 'U-1')).toBeNull();
  });
});
