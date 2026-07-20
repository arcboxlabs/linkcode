import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import type {
  AgentCapabilities,
  AgentEvent,
  AgentHistoryCapabilities,
  AgentHistoryListResult,
  AgentHistoryReadResult,
  AgentInput,
  AgentStartCatalog,
  LoopSpec,
  MessageId,
  ValidatedWireMessage,
  WirePayload,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestEngine } from './fixtures/test-engine';

/** Adapter that answers any prompt turn with one assistant chunk and a stop. */
class LoopFakeAdapter implements AgentAdapter {
  readonly kind = 'claude-code' as const;
  readonly capabilities: AgentCapabilities = { slashCommands: false, shellCommand: false };
  readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: false,
    resume: false,
  };
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  start(): Promise<void> {
    return Promise.resolve();
  }

  send(input: AgentInput): Promise<void> {
    if (input.type === 'prompt') {
      this.emit({
        type: 'agent-message-chunk',
        messageId: 'm1' as MessageId,
        content: textBlock('worker finished'),
      });
      this.emit({ type: 'stop', stopReason: 'end_turn' });
    }
    return Promise.resolve();
  }

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  startCatalog(): Promise<AgentStartCatalog> {
    return Promise.resolve({ models: [], policies: [] });
  }

  listHistory(): Promise<AgentHistoryListResult> {
    return Promise.resolve({ sessions: [] });
  }

  readHistory(): Promise<AgentHistoryReadResult> {
    return Promise.reject(new Error('no history'));
  }

  resumeHistory(): Promise<void> {
    return Promise.reject(new Error('no history'));
  }

  private emit(event: AgentEvent): void {
    for (const cb of this.listeners) cb(event);
  }
}

function pick<K extends WirePayload['kind']>(
  sent: WirePayload[],
  kind: K,
  replyTo?: string,
): Extract<WirePayload, { kind: K }> {
  const found = sent.find(
    (p): p is Extract<WirePayload, { kind: K }> =>
      p.kind === kind && (replyTo === undefined || ('replyTo' in p && p.replyTo === replyTo)),
  );
  return nullthrow(found, `no ${kind} payload`);
}

function harness() {
  const sent: WirePayload[] = [];
  let handler: ((msg: ValidatedWireMessage) => void) | null = null;
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: ValidatedWireMessage) {
      sent.push(msg.payload);
    },
    onMessage(cb) {
      handler = cb;
      return noop;
    },
    onClose: () => noop,
    close: noop,
  };
  const factory: AdapterFactory = () => new LoopFakeAdapter();
  const engine = createTestEngine(transport, { factory });

  function inject(payload: WirePayload): void {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
  }
  async function settle(): Promise<void> {
    for (let i = 0; i < 40; i += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }
  return { engine, sent, inject, settle };
}

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'engine-loop-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('engine loop wiring', () => {
  it('starts a loop that drives a hidden worker and succeeds when the check passes', async () => {
    const spec: LoopSpec = {
      kind: 'claude-code',
      cwd: workdir,
      prompt: 'do the work',
      verifyChecks: ['true'],
      maxIterations: 3,
      sleepMs: 0,
    };
    const h = harness();
    await h.engine.start();
    h.inject({ kind: 'loop.start', clientReqId: 'c1', spec });
    await vi.waitFor(
      () => {
        const latest = h.sent.flatMap((p) => (p.kind === 'loop.changed' ? [p.loop] : [])).at(-1);
        expect(latest?.status).toBe('succeeded');
      },
      { timeout: 5000 },
    );

    const loopId = pick(h.sent, 'loop.started', 'c1').loop.loopId;
    const final = h.sent.flatMap((p) => (p.kind === 'loop.changed' ? [p.loop] : [])).at(-1);
    expect(final?.loopId).toBe(loopId);
    expect(final?.status).toBe('succeeded');
    expect(final?.iterationCount).toBe(1);

    // The worker session ran hidden, tagged with the loop, and is kept (stopped).
    h.inject({ kind: 'session.list', clientReqId: 'c2' });
    await h.settle();
    const workerSession = pick(h.sent, 'session.listed', 'c2').sessions.find(
      (s) => s.automation !== undefined,
    );
    expect(workerSession?.automation).toEqual({ kind: 'loop', id: loopId });
    expect(workerSession?.status).toBe('stopped');
  });

  it('inspect returns the record, iterations, and log tail', async () => {
    const spec: LoopSpec = {
      kind: 'claude-code',
      cwd: workdir,
      prompt: 'do the work',
      verifyChecks: ['false'],
      maxIterations: 2,
      sleepMs: 0,
    };
    const h = harness();
    await h.engine.start();
    h.inject({ kind: 'loop.start', clientReqId: 'c1', spec });
    await vi.waitFor(
      () => {
        const latest = h.sent.flatMap((p) => (p.kind === 'loop.changed' ? [p.loop] : [])).at(-1);
        expect(latest?.status).toBe('failed');
      },
      { timeout: 5000 },
    );
    const loopId = pick(h.sent, 'loop.started', 'c1').loop.loopId;

    h.inject({ kind: 'loop.inspect', clientReqId: 'c2', loopId });
    await h.settle();
    const inspected = pick(h.sent, 'loop.inspected', 'c2');
    expect(inspected.loop.status).toBe('failed');
    expect(inspected.iterations).toHaveLength(2);
    expect(inspected.iterations.every((it) => it.status === 'failed')).toBe(true);
    expect(inspected.logs.length).toBeGreaterThan(0);
    // Log seqs are monotonic and unique.
    const seqs = inspected.logs.map((entry) => entry.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});
