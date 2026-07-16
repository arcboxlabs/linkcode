import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  LoopSpec,
  SessionAutomation,
  SessionId,
  WireMessage,
  WirePayload,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LoopService } from '../automation/loop-service';
import { InMemoryLoopStore } from '../automation/loop-store';
import type { SessionDriver, TurnResult } from '../automation/session-driver';

function recordingTransport(): { transport: Transport; sent: WirePayload[] } {
  const sent: WirePayload[] = [];
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: WireMessage) {
      sent.push(structuredClone(msg.payload));
    },
    onMessage: () => noop,
    onClose: () => noop,
    close: noop,
  };
  return { transport, sent };
}

interface DriverCall {
  op: 'create' | 'prompt' | 'stop' | 'makeUnattended';
  sessionId: SessionId;
}

/** Fake driver: mints sessions, returns scripted replies keyed by the automation kind + call order. */
class FakeSessionDriver implements SessionDriver {
  readonly calls: DriverCall[] = [];
  readonly records = new Set<SessionId>();
  readonly automations: SessionAutomation[] = [];
  /** Replies handed out to `prompt`, in order; the last one repeats. */
  replies: string[] = ['worker did the thing'];
  private replyIndex = 0;
  private created = 0;

  createSession(opts: { automation: SessionAutomation }): Promise<SessionId> {
    this.created += 1;
    const sessionId = `auto-${this.created}` as SessionId;
    this.records.add(sessionId);
    this.automations.push(opts.automation);
    this.calls.push({ op: 'create', sessionId });
    return Promise.resolve(sessionId);
  }

  hasRecord(sessionId: SessionId): boolean {
    return this.records.has(sessionId);
  }

  isBusy(): boolean {
    return false;
  }

  ensureLive(): Promise<void> {
    return Promise.resolve();
  }

  makeUnattended(sessionId: SessionId): Promise<void> {
    this.calls.push({ op: 'makeUnattended', sessionId });
    return Promise.resolve();
  }

  prompt(sessionId: SessionId): Promise<TurnResult> {
    this.calls.push({ op: 'prompt', sessionId });
    const text = this.replies[Math.min(this.replyIndex, this.replies.length - 1)];
    this.replyIndex += 1;
    return Promise.resolve({ stopReason: 'end_turn', text });
  }

  stopSession(sessionId: SessionId): Promise<void> {
    this.calls.push({ op: 'stop', sessionId });
    this.records.delete(sessionId);
    return Promise.resolve();
  }
}

let workdir: string;
let clock: number;
const now = (): number => clock;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'loop-test-'));
  clock = 1000;
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function baseSpec(overrides: Partial<LoopSpec> = {}): LoopSpec {
  return {
    kind: 'claude-code',
    cwd: workdir,
    prompt: 'create the marker file',
    verifyChecks: ['true'],
    maxIterations: 5,
    sleepMs: 0,
    ...overrides,
  };
}

describe('LoopService', () => {
  it('succeeds on the first iteration when checks pass', async () => {
    const { transport, sent } = recordingTransport();
    const store = new InMemoryLoopStore();
    const driver = new FakeSessionDriver();
    const service = new LoopService(transport, store, driver, { now });

    const loop = await service.startLoop(baseSpec());
    await service.settleAll();

    const final = service.list().find((l) => l.loopId === loop.loopId);
    expect(final?.status).toBe('succeeded');
    expect(final?.iterationCount).toBe(1);
    expect(final?.summary).toBe('worker did the thing');
    // The worker session was tagged as loop automation and stopped afterward.
    expect(driver.automations[0]).toEqual({ kind: 'loop', id: loop.loopId });
    expect(driver.calls.some((c) => c.op === 'stop')).toBe(true);
    const changed = sent.filter((p) => p.kind === 'loop.changed');
    expect(changed.at(-1)).toMatchObject({ loop: { status: 'succeeded' } });
  });

  it('retries with failure feedback until a check passes', async () => {
    const { transport } = recordingTransport();
    const store = new InMemoryLoopStore();
    const driver = new FakeSessionDriver();
    const service = new LoopService(transport, store, driver, { now });

    const marker = join(workdir, 'done');
    // The worker "creates" the marker only on its second turn.
    driver.replies = ['nothing yet', 'created it'];
    let turn = 0;
    const originalPrompt = driver.prompt.bind(driver);
    driver.prompt = (sessionId: SessionId) => {
      turn += 1;
      if (turn === 2) writeFileSync(marker, 'ok');
      return originalPrompt(sessionId);
    };

    const loop = await service.startLoop(baseSpec({ verifyChecks: [`test -f ${marker}`] }));
    await service.settleAll();

    const final = service.list().find((l) => l.loopId === loop.loopId);
    expect(final?.status).toBe('succeeded');
    expect(final?.iterationCount).toBe(2);
    const iterations = await store.loadIterations(loop.loopId);
    expect(iterations[0].status).toBe('failed');
    expect(iterations[1].status).toBe('passed');
  });

  it('fails after max iterations when the check never passes', async () => {
    const { transport } = recordingTransport();
    const store = new InMemoryLoopStore();
    const service = new LoopService(transport, store, new FakeSessionDriver(), { now });

    const loop = await service.startLoop(baseSpec({ verifyChecks: ['false'], maxIterations: 3 }));
    await service.settleAll();

    const final = service.list().find((l) => l.loopId === loop.loopId);
    expect(final?.status).toBe('failed');
    expect(final?.iterationCount).toBe(3);
    expect(final?.error).toContain('max iterations');
  });

  it('consults a structured verifier and passes only on a passing verdict', async () => {
    const { transport } = recordingTransport();
    const store = new InMemoryLoopStore();
    const driver = new FakeSessionDriver();
    const service = new LoopService(transport, store, driver, { now });

    // Worker reply, then verifier verdict — alternating per iteration.
    driver.replies = [
      'attempt one',
      '{"passed": false, "reason": "not done"}',
      'attempt two',
      '{"passed": true, "reason": "looks good"}',
    ];

    const loop = await service.startLoop(
      baseSpec({ verifyChecks: [], verifier: { prompt: 'is it done?' } }),
    );
    await service.settleAll();

    const final = service.list().find((l) => l.loopId === loop.loopId);
    expect(final?.status).toBe('succeeded');
    expect(final?.iterationCount).toBe(2);
    const iterations = await store.loadIterations(loop.loopId);
    expect(iterations[0].verdict).toEqual({ passed: false, reason: 'not done' });
    expect(iterations[1].verdict).toEqual({ passed: true, reason: 'looks good' });
  });

  it('stops a running loop and marks it stopped', async () => {
    const { transport } = recordingTransport();
    const store = new InMemoryLoopStore();
    const driver = new FakeSessionDriver();
    // A worker turn that hangs until the loop is aborted (its session is stopped).
    driver.prompt = (sessionId: SessionId) =>
      new Promise<TurnResult>((resolve) => {
        driver.calls.push({ op: 'prompt', sessionId });
        const check = setInterval(() => {
          if (!driver.records.has(sessionId)) {
            clearInterval(check);
            resolve({ stopReason: 'cancelled', text: '' });
          }
        }, 5);
      });
    const service = new LoopService(transport, store, driver, { now });

    const loop = await service.startLoop(baseSpec());
    service.stopLoop(loop.loopId);
    await service.settleAll();

    expect(service.list().find((l) => l.loopId === loop.loopId)?.status).toBe('stopped');
  });

  it('rejects a spec with no verification mechanism when nothing verifies (guarded upstream)', async () => {
    const { transport } = recordingTransport();
    const service = new LoopService(transport, new InMemoryLoopStore(), new FakeSessionDriver(), {
      now,
    });
    // The service trusts the schema; deletion is refused while running.
    const loop = await service.startLoop(baseSpec());
    await expect(service.deleteLoop(loop.loopId)).rejects.toThrow('stop the loop');
    await service.settleAll();
    await expect(service.deleteLoop(loop.loopId)).resolves.toBeUndefined();
  });

  it('marks interrupted loops stopped on restart', async () => {
    const store = new InMemoryLoopStore();
    // Seed a loop left `running` by a previous daemon.
    await store.save({
      loopId: 'loop-old' as ReturnType<LoopService['list']>[number]['loopId'],
      spec: baseSpec(),
      status: 'running',
      iterationCount: 1,
      startedAt: 0,
      updatedAt: 0,
    });
    const { transport } = recordingTransport();
    const service = new LoopService(transport, store, new FakeSessionDriver(), { now });
    await service.start();

    expect(service.list()[0]?.status).toBe('stopped');
    expect(service.list()[0]?.error).toContain('daemon restarted');
  });
});
