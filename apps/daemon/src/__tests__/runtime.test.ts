import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DaemonIdentity } from '@linkcode/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DaemonAlreadyRunningError,
  findRunningDaemon,
  listenWithPortHunt,
  probeDaemonIdentity,
  writeRuntimeFile,
} from '../runtime';

const servers: Server[] = [];
let savedHome: string | undefined;

// The runtime file lives under os.homedir(); point HOME at a fresh temp dir per test.
beforeEach(() => {
  savedHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'linkcode-runtime-'));
});

afterEach(async () => {
  process.env.HOME = savedHome;
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    ),
  );
});

function identity(pid: number): DaemonIdentity {
  return { name: 'linkcode-daemon', pid, startedAt: Date.now() };
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function serveIdentity(id: DaemonIdentity): Promise<number> {
  return listen((req, res) => {
    if (req.url?.startsWith('/linkcode')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(id));
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

function serveForeign(): Promise<number> {
  return listen((_req, res) => {
    res.writeHead(200);
    res.end('not a daemon');
  });
}

/** A pid guaranteed dead: a just-exited child process. */
function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '']).pid;
}

describe('probeDaemonIdentity', () => {
  it('returns the identity served at /linkcode', async () => {
    const id = identity(1234);
    const port = await serveIdentity(id);
    await expect(probeDaemonIdentity(`http://127.0.0.1:${port}`)).resolves.toEqual(id);
  });

  it('returns null for a foreign occupant', async () => {
    const port = await serveForeign();
    await expect(probeDaemonIdentity(`http://127.0.0.1:${port}`)).resolves.toBeNull();
  });

  it('returns null when nothing listens', async () => {
    const port = await serveForeign();
    await new Promise((resolve) => {
      servers.pop()?.close(resolve);
    });
    await expect(probeDaemonIdentity(`http://127.0.0.1:${port}`)).resolves.toBeNull();
  });

  it('retries a timed-out attempt and recovers a slow daemon', async () => {
    const id = identity(1234);
    let requests = 0;
    // First request hangs past the probe timeout; the retry is answered immediately.
    const port = await listen((_req, res) => {
      requests += 1;
      if (requests === 1) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(id));
    });
    await expect(probeDaemonIdentity(`http://127.0.0.1:${port}`, 200)).resolves.toEqual(id);
    expect(requests).toBe(2);
  });

  it('returns null once every timeout retry is exhausted', async () => {
    let requests = 0;
    const port = await listen(() => {
      requests += 1;
    });
    await expect(probeDaemonIdentity(`http://127.0.0.1:${port}`, 50)).resolves.toBeNull();
    expect(requests).toBe(3);
  });
});

describe('listenWithPortHunt', () => {
  it('hunts past a foreign occupant to the next port', async () => {
    const port = await serveForeign();
    const { server, url } = await listenWithPortHunt(
      { type: 'ws', port, host: '127.0.0.1' },
      identity(process.pid),
    );
    expect(url).toBe(`ws://127.0.0.1:${port + 1}`);
    await server.close();
  });

  it('refuses to hunt past a live linkcode daemon', async () => {
    const port = await serveIdentity(identity(4242));
    await expect(
      listenWithPortHunt({ type: 'ws', port, host: '127.0.0.1' }, identity(process.pid)),
    ).rejects.toBeInstanceOf(DaemonAlreadyRunningError);
  });

  it('hunts past an occupant with its own pid (a sibling listener)', async () => {
    const self = identity(process.pid);
    const port = await serveIdentity(self);
    const { server, url } = await listenWithPortHunt({ type: 'ws', port, host: '127.0.0.1' }, self);
    expect(url).toBe(`ws://127.0.0.1:${port + 1}`);
    await server.close();
  });

  it('hunts past a live daemon of another profile', async () => {
    const port = await serveIdentity({ ...identity(4242), profile: 'alpha' });
    const { server, url } = await listenWithPortHunt(
      { type: 'ws', port, host: '127.0.0.1' },
      identity(process.pid),
    );
    expect(url).toBe(`ws://127.0.0.1:${port + 1}`);
    await server.close();
  });

  it('refuses to hunt past a live daemon of the same profile', async () => {
    const port = await serveIdentity({ ...identity(4242), profile: 'alpha' });
    await expect(
      listenWithPortHunt(
        { type: 'ws', port, host: '127.0.0.1' },
        { ...identity(process.pid), profile: 'alpha' },
      ),
    ).rejects.toBeInstanceOf(DaemonAlreadyRunningError);
  });
});

describe('findRunningDaemon', () => {
  it('returns null without a runtime file', async () => {
    await expect(findRunningDaemon()).resolves.toBeNull();
  });

  it('ignores a stale file whose pid is dead', async () => {
    writeRuntimeFile({
      ...identity(deadPid()),
      listeners: [{ type: 'socket.io', url: 'http://127.0.0.1:1' }],
    });
    await expect(findRunningDaemon()).resolves.toBeNull();
  });

  it('returns the advertised daemon when pid and endpoint agree', async () => {
    const id = identity(process.pid);
    const port = await serveIdentity(id);
    const info = {
      ...id,
      listeners: [{ type: 'socket.io' as const, url: `http://127.0.0.1:${port}` }],
    };
    writeRuntimeFile(info);
    await expect(findRunningDaemon()).resolves.toEqual(info);
  });

  it('returns null when the endpoint answers with a different pid', async () => {
    const port = await serveIdentity(identity(process.pid + 1));
    writeRuntimeFile({
      ...identity(process.pid),
      listeners: [{ type: 'socket.io', url: `http://127.0.0.1:${port}` }],
    });
    await expect(findRunningDaemon()).resolves.toBeNull();
  });
});
