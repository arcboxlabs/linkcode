import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DaemonIdentity } from '@linkcode/schema';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  DaemonAlreadyRunningError,
  findRunningDaemon,
  listenWithPortHunt,
  probeDaemonIdentity,
  writeRuntimeFile,
} from '../../src/runtime';

const directory = mkdtempSync(join(tmpdir(), 'linkcode-ipv6-'));
vi.mock('../../src/config', () => ({ runtimeFilePath: () => join(directory, 'runtime.json') }));

afterAll(() => rmSync(directory, { recursive: true }));

const identity: DaemonIdentity = {
  name: 'linkcode-daemon',
  pid: process.pid,
  startedAt: Date.now(),
};

async function availablePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '::1', resolve);
  });
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve) => {
    reservation.close(() => resolve());
  });
  return port;
}

describe('IPv6 listener advertisement', () => {
  it.each(['ws', 'socket.io'] as const)(
    'discovers the real %s listener through its URL',
    async (type) => {
      const listener = await listenWithPortHunt(
        { type, host: '::1', port: await availablePort() },
        identity,
      );
      try {
        const url = new URL(listener.url);
        expect(url.hostname).toBe('[::1]');
        url.protocol = 'http:';
        await expect(probeDaemonIdentity(url.href)).resolves.toEqual(identity);
        const info = { ...identity, listeners: [{ type, url: listener.url }] };
        writeRuntimeFile(info);
        await expect(findRunningDaemon()).resolves.toEqual(info);
      } finally {
        await listener.server.close();
      }
    },
  );

  it('recognizes an existing IPv6 daemon instead of hunting past it', async () => {
    const listener = await listenWithPortHunt(
      { type: 'ws', host: '::1', port: await availablePort() },
      identity,
    );
    try {
      const attempt = listenWithPortHunt(
        { type: 'ws', host: '::1', port: listener.port },
        { ...identity, pid: identity.pid + 1 },
      );
      try {
        await expect(attempt).rejects.toBeInstanceOf(DaemonAlreadyRunningError);
      } finally {
        const unexpected = await attempt.catch(() => null);
        await unexpected?.server.close();
      }
    } finally {
      await listener.server.close();
    }
  });
});
