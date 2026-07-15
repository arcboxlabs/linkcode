import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentAdapter } from '@linkcode/agent-adapter';
import type { SessionId, WireMessage, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Engine } from '../engine';
import { FileSuggestService } from '../file-suggest-service';
import type { SessionStore } from '../session-store';
import { InMemorySessionStore } from '../session-store';

const tempRoots: string[] = [];
afterAll(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

function fakeAdapter(): AgentAdapter {
  return {
    kind: 'claude-code',
    capabilities: { slashCommands: false, shellCommand: false },
    historyCapabilities: { list: false, read: false, resume: false },
    start: () => Promise.resolve(),
    listHistory: () => Promise.reject(new Error('unsupported')),
    readHistory: () => Promise.reject(new Error('unsupported')),
    resumeHistory: () => Promise.reject(new Error('unsupported')),
    send: () => Promise.resolve(),
    onEvent: () => noop,
    stop: () => Promise.resolve(),
  };
}

/** Let the fire-and-forget handle() chains settle. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function harness(store: SessionStore = new InMemorySessionStore()) {
  const sent: WirePayload[] = [];
  let handler: ((msg: WireMessage) => void) | null = null;
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: WireMessage) {
      sent.push(msg.payload);
    },
    onMessage(cb) {
      handler = cb;
      return noop;
    },
    onClose: () => noop,
    close: noop,
  };
  const fileSuggest = new FileSuggestService();
  const suggest = vi.spyOn(fileSuggest, 'suggest').mockResolvedValue([{ path: 'src/index.ts' }]);
  const engine = new Engine(transport, { factory: fakeAdapter, fileSuggest, sessionStore: store });

  async function inject(payload: WirePayload): Promise<void> {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
    await tick();
  }

  return { engine, sent, inject, suggest };
}

function suggestions(sent: WirePayload[], replyTo: string) {
  const result = sent.find((p) => p.kind === 'file.suggest.result' && p.replyTo === replyTo);
  if (result?.kind !== 'file.suggest.result') {
    throw new Error(`no file.suggest.result for ${replyTo}`);
  }
  return result.suggestions;
}

describe('engine file.suggest', () => {
  it('rejects a cwd that is not a registered workspace, without touching the service', async () => {
    const { engine, sent, inject, suggest } = harness();
    await engine.start();

    await inject({ kind: 'file.suggest', clientReqId: 'r1', cwd: '/etc', query: '' });

    const failed = sent.find((p) => p.kind === 'request.failed' && p.replyTo === 'r1');
    if (failed?.kind !== 'request.failed') throw new Error('no request.failed for r1');
    expect(failed.message).toContain('Unknown workspace');
    expect(suggest).not.toHaveBeenCalled();
    expect(sent.some((p) => p.kind === 'file.suggest.result')).toBe(false);
  });

  it('serves a session-touched workspace under its canonical registered root', async () => {
    const { engine, sent, inject, suggest } = harness();
    await engine.start();
    await inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });

    // A different spelling of the same root (trailing separator) still resolves, and the
    // search runs under the registered record's cwd, not the caller's spelling.
    await inject({
      kind: 'file.suggest',
      clientReqId: 'r2',
      cwd: '/repo/',
      query: 'ind',
      limit: 10,
    });

    expect(suggestions(sent, 'r2')).toEqual([{ path: 'src/index.ts' }]);
    expect(suggest).toHaveBeenCalledWith('/repo', 'ind', 10);
  });

  it('serves an explicitly registered workspace', async () => {
    const { engine, sent, inject } = harness();
    await engine.start();
    const dir = await mkdtemp(path.join(tmpdir(), 'lc-suggest-'));
    tempRoots.push(dir);
    await inject({ kind: 'workspace.register', clientReqId: 'r1', cwd: dir });

    await inject({ kind: 'file.suggest', clientReqId: 'r2', cwd: dir, query: '' });

    expect(suggestions(sent, 'r2')).toEqual([{ path: 'src/index.ts' }]);
  });

  it('re-registers a resumed session cwd the registry no longer knows', async () => {
    const store = new InMemorySessionStore();
    const first = harness(store);
    await first.engine.start();
    await first.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const started = first.sent.find((p) => p.kind === 'session.started' && p.replyTo === 'r1');
    if (started?.kind !== 'session.started') throw new Error('no session.started for r1');
    const sessionId: SessionId = started.sessionId;

    // A fresh engine over the same session store has an empty workspace registry (the daemon
    // persists workspaces, but an archived root looks the same): resuming the session must
    // re-register its cwd for the @-mention path.
    const second = harness(store);
    await second.engine.start();
    await second.inject({ kind: 'session.resume', clientReqId: 'r2', sessionId });

    await second.inject({ kind: 'file.suggest', clientReqId: 'r3', cwd: '/repo', query: '' });

    expect(suggestions(second.sent, 'r3')).toEqual([{ path: 'src/index.ts' }]);
  });
});
