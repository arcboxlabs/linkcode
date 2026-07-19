import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { CodexAppServer } from '../native/codex/app-server';

const RE_TAIL = /TAIL$/;

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => boolean;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.emit('exit', null);
    return true;
  };
  const writes: Array<Record<string, unknown>> = [];
  let buffered = '';
  child.stdin.on('data', (chunk: Buffer) => {
    buffered += chunk.toString();
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) writes.push(JSON.parse(line) as Record<string, unknown>);
  });
  return {
    child,
    writes,
    receive(message: unknown) {
      child.stdout.write(`${JSON.stringify(message)}\n`);
    },
    noise(line: string) {
      child.stdout.write(`${line}\n`);
    },
  };
}

async function attach(child: ReturnType<typeof fakeChild>) {
  const notifications: Array<{ method: string; params: unknown }> = [];
  const exits: Array<{ code: number | null; stderrTail: string }> = [];
  const starting = CodexAppServer.attach(child.child as never, {
    onNotification: (method, params) => notifications.push({ method, params }),
    onExit: (code, stderrTail) => exits.push({ code, stderrTail }),
  });
  await vi.waitFor(() => expect(child.writes).toHaveLength(1));
  child.receive({ id: 1, result: {} });
  const server = await starting;
  return { server, notifications, exits };
}

describe('CodexAppServer stdio JSON-RPC', () => {
  it('completes initialize/initialized handshake over an attached child', async () => {
    const child = fakeChild();

    const { server } = await attach(child);

    expect(child.writes).toEqual([
      {
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'linkcode', title: 'Link Code', version: '0.0.0' },
          capabilities: { experimentalApi: true, requestAttestation: false },
        },
      },
      { method: 'initialized', params: {} },
    ]);
    server.close();
  });

  it('ignores bad stdout and routes responses, notifications, and server requests', async () => {
    const child = fakeChild();
    const { server, notifications } = await attach(child);
    server.setRequestHandler('approval/request', (params) => Promise.resolve({ accepted: params }));

    child.noise('not json');
    child.noise('42');
    child.receive({ method: 'turn/started', params: { id: 'turn-1' } });
    child.receive({ id: 'server-1', method: 'approval/request', params: { item: 'item-1' } });
    const request = server.request('thread/start', { cwd: '/repo' });
    await vi.waitFor(() => expect(child.writes).toHaveLength(4));
    child.receive({ id: 2, result: { thread: { id: 'thread-1' } } });

    await expect(request).resolves.toEqual({ thread: { id: 'thread-1' } });
    expect(notifications).toEqual([{ method: 'turn/started', params: { id: 'turn-1' } }]);
    await vi.waitFor(() =>
      expect(child.writes).toContainEqual({
        id: 'server-1',
        result: { accepted: { item: 'item-1' } },
      }),
    );
    server.close();
  });

  it('rejects a request carrying a JSON-RPC error', async () => {
    const child = fakeChild();
    const { server } = await attach(child);
    const request = server.request('turn/start', {});
    child.receive({ id: 2, error: { code: -32600, message: 'invalid request' } });

    await expect(request).rejects.toThrow('codex: invalid request');
    server.close();
  });

  it('rejects every pending request when the child exits', async () => {
    const child = fakeChild();
    const { server, exits } = await attach(child);
    const first = server.request('first', {});
    const second = server.request('second', {});

    child.child.emit('exit', 7);

    await expect(first).rejects.toThrow('codex: app-server exited (code 7)');
    await expect(second).rejects.toThrow('codex: app-server exited (code 7)');
    expect(exits).toEqual([{ code: 7, stderrTail: '' }]);
  });

  it('includes only the stderr tail in exit diagnostics', async () => {
    const child = fakeChild();
    const { server, exits } = await attach(child);
    const request = server.request('turn/start', {});
    child.child.stderr.write(`discarded:${'x'.repeat(2100)}TAIL`);

    child.child.emit('exit', 1);

    await expect(request).rejects.toThrow(RE_TAIL);
    expect(exits).toHaveLength(1);
    expect(exits[0].stderrTail).toHaveLength(2048);
    expect(exits[0].stderrTail).not.toContain('discarded:');
    expect(exits[0].stderrTail).toMatch(RE_TAIL);
  });
});
