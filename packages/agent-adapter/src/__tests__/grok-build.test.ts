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
  };
  return {
    child,
    pushStdout(line: string) {
      stdout.write(`${line}\n`);
    },
    exit(code) {
      child.emit('exit', code);
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
    expect(isAuthFailureMessage('ok')).toBe(false);
  });
});

describe('attachGrokHeadlessChild', () => {
  it('forwards NDJSON events and resolves on exit', async () => {
    const { child, pushStdout, exit } = fakeChild();
    const events: unknown[] = [];
    const run = grokProcess.attachGrokHeadlessChild(child as never, (e) => events.push(e));
    pushStdout('{"type":"text","data":"a"}');
    pushStdout('{"type":"end","stopReason":"EndTurn","sessionId":"s1"}');
    exit(0);
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

  it('streams thought/text and settles with session-ref + usage', async () => {
    vi.spyOn(agentRuntimeProber, 'resolveBinary').mockReturnValue('/usr/bin/grok');
    const { child, pushStdout, exit } = fakeChild();
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
});
