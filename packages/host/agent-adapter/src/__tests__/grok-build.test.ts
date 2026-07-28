import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { AgentEvent, ContentBlock } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrokBuildAdapter } from '../native/grok-build/adapter';
import {
  isAuthFailureMessage,
  mapGrokStopReason,
  mapGrokUsage,
  parseGrokStreamLine,
} from '../native/grok-build/map';
import type { GrokHeadlessRunOptions } from '../native/grok-build/process';
import * as grokProcess from '../native/grok-build/process';
import { agentRuntimeProber } from '../probe';

const RE_CLI_NOT_FOUND = /CLI not found/;

function textPrompt(text: string): ContentBlock[] {
  return [textBlock(text)];
}

/** Minimal ChildProcess stand-in for attachGrokHeadlessChild. */
function fakeChild(): {
  child: EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => void;
    stdin: null;
  };
  pushStdout: (line: string) => void;
  exit: (code: number | null) => void;
  close: (code: number | null) => void;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => void;
    stdin: null;
  };
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = null;
  child.kill = () => {
    child.emit('exit', null);
    stdout.end();
    stderr.end();
    child.emit('close', null);
  };
  return {
    child,
    pushStdout(line: string) {
      stdout.write(`${line}\n`);
    },
    exit(code) {
      child.emit('exit', code);
    },
    close(code) {
      stdout.end();
      stderr.end();
      child.emit('close', code);
    },
  };
}

describe('grok-build stream map', () => {
  it('parses text/thought/end lines and ignores junk', () => {
    expect(parseGrokStreamLine('{"type":"text","data":"Hi"}')).toEqual({
      type: 'text',
      data: 'Hi',
    });
    expect(parseGrokStreamLine('{"type":"thought","data":"…"}')).toEqual({
      type: 'thought',
      data: '…',
    });
    expect(parseGrokStreamLine('not-json')).toBeUndefined();
    expect(parseGrokStreamLine('')).toBeUndefined();
  });

  it('maps stop reasons and usage', () => {
    expect(mapGrokStopReason('EndTurn')).toBe('end_turn');
    expect(mapGrokStopReason('cancelled')).toBe('cancelled');
    expect(
      mapGrokUsage({
        input_tokens: 10,
        output_tokens: 3,
        cache_read_input_tokens: 2,
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 3, cacheReadTokens: 2 });
  });

  it('detects auth-shaped failures', () => {
    expect(isAuthFailureMessage('Not authenticated')).toBe(true);
    expect(isAuthFailureMessage('Invalid API key')).toBe(true);
    expect(isAuthFailureMessage('authoring output failed')).toBe(false);
    expect(isAuthFailureMessage('ok')).toBe(false);
  });
});

describe('attachGrokHeadlessChild', () => {
  it('waits for stdio close and preserves a final event written after exit', async () => {
    const { child, pushStdout, exit, close } = fakeChild();
    const events: unknown[] = [];
    const run = grokProcess.attachGrokHeadlessChild(child as never, (e) => events.push(e));
    pushStdout('{"type":"text","data":"a"}');
    exit(0);
    let settled = false;
    void run.done.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    pushStdout('{"type":"end","stopReason":"EndTurn","sessionId":"s1"}');
    close(0);
    await expect(run.done).resolves.toEqual({ exitCode: 0, stderrTail: '' });
    expect(events).toEqual([
      { type: 'text', data: 'a' },
      { type: 'end', stopReason: 'EndTurn', sessionId: 's1' },
    ]);
  });
});

describe('GrokBuildAdapter', () => {
  beforeEach(() => {
    vi.spyOn(grokProcess, 'runGrokHeadless');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails start when no CLI is resolved', async () => {
    vi.spyOn(agentRuntimeProber, 'resolveBinary').mockReturnValue(undefined);
    const adapter = new GrokBuildAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await expect(adapter.start({ kind: 'grok-build', cwd: '/tmp' })).rejects.toThrow(
      RE_CLI_NOT_FOUND,
    );
    expect(events.some((e) => e.type === 'error' && e.code === 'sdk-unavailable')).toBe(true);
  });

  it('uses and reflects initial effort on the first headless run', async () => {
    vi.spyOn(agentRuntimeProber, 'resolveBinary').mockReturnValue('/usr/bin/grok');
    const { child, exit, close } = fakeChild();
    vi.mocked(grokProcess.runGrokHeadless).mockImplementation((opts: GrokHeadlessRunOptions) => {
      const run = grokProcess.attachGrokHeadlessChild(child as never, opts.onEvent);
      queueMicrotask(() => {
        exit(0);
        close(0);
      });
      return run;
    });
    const adapter = new GrokBuildAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));
    await adapter.start({ kind: 'grok-build', cwd: '/tmp', effort: 'medium' });
    await adapter.send({ type: 'prompt', content: textPrompt('hi') });

    expect(grokProcess.runGrokHeadless).toHaveBeenCalledWith(
      expect.objectContaining({ effort: 'medium', model: undefined }),
    );
    expect(events).toContainEqual({ type: 'effort-update', effort: 'medium' });
    expect(events).toContainEqual({ type: 'model-update', model: 'grok-4.5' });
  });

  it('rejects effort levels the Grok CLI cannot represent', async () => {
    const adapter = new GrokBuildAdapter();
    await expect(
      adapter.start({ kind: 'grok-build', cwd: '/tmp', effort: 'xhigh' }),
    ).rejects.toThrow("grok-build: effort 'xhigh' is not supported");
  });

  it('reflects an explicit model only after a successful headless run validates it', async () => {
    vi.spyOn(agentRuntimeProber, 'resolveBinary').mockReturnValue('/usr/bin/grok');
    const { child, exit, close } = fakeChild();
    vi.mocked(grokProcess.runGrokHeadless).mockImplementation((opts: GrokHeadlessRunOptions) => {
      const run = grokProcess.attachGrokHeadlessChild(child as never, opts.onEvent);
      queueMicrotask(() => {
        exit(0);
        close(0);
      });
      return run;
    });
    const adapter = new GrokBuildAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));

    await adapter.start({ kind: 'grok-build', cwd: '/tmp', model: 'grok-next' });
    expect(events).not.toContainEqual({ type: 'model-update', model: 'grok-next' });

    await adapter.send({ type: 'prompt', content: textPrompt('hi') });
    expect(events).toContainEqual({ type: 'model-update', model: 'grok-next' });
  });

  it('does not let a completed turn overwrite a newer next-turn model', async () => {
    vi.spyOn(agentRuntimeProber, 'resolveBinary').mockReturnValue('/usr/bin/grok');
    const { child, exit, close } = fakeChild();
    vi.mocked(grokProcess.runGrokHeadless).mockImplementation((opts: GrokHeadlessRunOptions) =>
      grokProcess.attachGrokHeadlessChild(child as never, opts.onEvent),
    );
    const adapter = new GrokBuildAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));
    await adapter.start({ kind: 'grok-build', cwd: '/tmp', model: 'grok-turn' });

    const turn = adapter.send({ type: 'prompt', content: textPrompt('hi') });
    await vi.waitFor(() => {
      expect(grokProcess.runGrokHeadless).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'grok-turn' }),
      );
    });
    await adapter.send({ type: 'set-model', model: 'grok-next' });
    exit(0);
    close(0);
    await turn;

    const reflected = events.flatMap((event) =>
      event.type === 'model-update' ? [event.model] : [],
    );
    expect(reflected).toEqual(['grok-next']);
  });

  it('advertises its fixed bypass posture without supporting policy changes', async () => {
    vi.spyOn(agentRuntimeProber, 'resolveBinary').mockReturnValue('/usr/bin/grok');
    const adapter = new GrokBuildAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));

    await adapter.start({ kind: 'grok-build', cwd: '/tmp' });

    expect(events).toContainEqual({
      type: 'approval-policy-update',
      state: {
        availablePolicies: [
          {
            policyId: 'bypassPermissions',
            name: 'Bypass permissions',
            description: 'All tools run without approval prompts; this adapter cannot change it.',
          },
        ],
        currentPolicyId: 'bypassPermissions',
      },
    });
    await expect(
      adapter.send({ type: 'set-approval-policy', policyId: 'default' }),
    ).rejects.toThrow('grok-build: changing the approval policy is not supported');
  });

  it('streams thought/text and settles with session-ref + usage', async () => {
    vi.spyOn(agentRuntimeProber, 'resolveBinary').mockReturnValue('/usr/bin/grok');
    const { child, pushStdout, exit, close } = fakeChild();
    vi.mocked(grokProcess.runGrokHeadless).mockImplementation((opts: GrokHeadlessRunOptions) => {
      const run = grokProcess.attachGrokHeadlessChild(child as never, opts.onEvent);
      queueMicrotask(() => {
        pushStdout('{"type":"thought","data":"think"}');
        pushStdout('{"type":"text","data":"hello"}');
        pushStdout(
          JSON.stringify({
            type: 'end',
            stopReason: 'EndTurn',
            sessionId: 'sess-1',
            usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0 },
          }),
        );
        exit(0);
        close(0);
      });
      return run;
    });

    const adapter = new GrokBuildAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start({ kind: 'grok-build', cwd: '/tmp', model: 'grok-4.5' });
    await adapter.send({ type: 'prompt', content: textPrompt('hi') });

    expect(events.some((e) => e.type === 'agent-thought-chunk')).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === 'agent-message-chunk' &&
          e.content.type === 'text' &&
          e.content.text === 'hello',
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === 'session-ref' && e.historyId === 'sess-1')).toBe(true);
    expect(events.some((e) => e.type === 'stop' && e.stopReason === 'end_turn')).toBe(true);
    expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
  });

  it('reports a nonzero process exit once without rejecting accepted input', async () => {
    vi.spyOn(agentRuntimeProber, 'resolveBinary').mockReturnValue('/usr/bin/grok');
    const { child, exit, close } = fakeChild();
    vi.mocked(grokProcess.runGrokHeadless).mockImplementation((opts: GrokHeadlessRunOptions) => {
      const run = grokProcess.attachGrokHeadlessChild(child as never, opts.onEvent);
      queueMicrotask(() => {
        exit(1);
        close(1);
      });
      return run;
    });

    const adapter = new GrokBuildAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));
    await adapter.start({ kind: 'grok-build', cwd: '/tmp' });
    await expect(
      adapter.send({ type: 'prompt', content: textPrompt('hi') }),
    ).resolves.toBeUndefined();

    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(events.some((event) => event.type === 'status' && event.status === 'idle')).toBe(true);
  });

  it('reports an externally signalled process as a failed turn', async () => {
    vi.spyOn(agentRuntimeProber, 'resolveBinary').mockReturnValue('/usr/bin/grok');
    const { child, exit, close } = fakeChild();
    vi.mocked(grokProcess.runGrokHeadless).mockImplementation((opts: GrokHeadlessRunOptions) => {
      const run = grokProcess.attachGrokHeadlessChild(child as never, opts.onEvent);
      queueMicrotask(() => {
        exit(null);
        close(null);
      });
      return run;
    });

    const adapter = new GrokBuildAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));
    await adapter.start({ kind: 'grok-build', cwd: '/tmp' });
    await adapter.send({ type: 'prompt', content: textPrompt('hi') });

    expect(
      events.some(
        (event) => event.type === 'error' && event.message.includes('terminated by signal'),
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === 'stop')).toBe(false);
  });
});
