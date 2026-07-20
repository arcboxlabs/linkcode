import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LinkCodeClient } from '@linkcode/client-core';
import { SocketIoTransport } from '@linkcode/transport';
import Sqlite from 'better-sqlite3';
import { wait } from 'foxts/wait';
import { waitFor } from 'foxts/wait-for';

const daemonDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(daemonDir, '..', '..');
const binaryName = process.platform === 'win32' ? 'linkcode-pty.exe' : 'linkcode-pty';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function main(): Promise<void> {
  assert(
    existsSync(join(daemonDir, 'dist/index.js')),
    'daemon dist is missing; run its build first',
  );
  const sidecar = [
    process.env.LINKCODE_PTY_SIDECAR_PATH,
    join(repoRoot, 'target', 'debug', binaryName),
    join(repoRoot, 'target', 'release', binaryName),
  ].find((path) => path && existsSync(path));
  assert(sidecar, 'linkcode-pty is missing; build the sidecar first');

  const home = mkdtempSync(join(tmpdir(), 'linkcode-daemon-e2e-'));
  const port = await freePort();
  const logs: string[] = [];
  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  const child = spawn(process.execPath, ['--import', './dist/instrument.js', 'dist/index.js'], {
    cwd: daemonDir,
    env: {
      ...process.env,
      HOME: home,
      LINKCODE_HOST: '127.0.0.1',
      LINKCODE_PORT: String(port),
      LINKCODE_PTY_SIDECAR_PATH: sidecar,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  child.once('exit', (code, signal) => {
    exit = { code, signal };
  });

  let client: LinkCodeClient | null = null;
  try {
    const runtimePath = join(home, '.linkcode', 'runtime.json');
    const runtime = await waitFor(
      () => {
        if (exit) throw new Error(`daemon exited during boot: ${JSON.stringify(exit)}`);
        if (!existsSync(runtimePath)) return false;
        try {
          return JSON.parse(readFileSync(runtimePath, 'utf8')) as {
            pid: number;
            listeners: Array<{ type: string; url: string }>;
          };
        } catch {
          return false;
        }
      },
      100,
      AbortSignal.timeout(30000),
    );
    assert.equal(runtime.pid, child.pid);
    const listener = runtime.listeners.find((entry) => entry.type === 'socket.io');
    assert.deepEqual(listener, { type: 'socket.io', url: `http://127.0.0.1:${port}` });

    const identity = (await fetch(`${listener.url}/linkcode`).then((response) =>
      response.json(),
    )) as {
      pid: number;
      name: string;
    };
    assert.equal(identity.pid, child.pid);
    assert.equal(identity.name, 'linkcode-daemon');

    client = new LinkCodeClient(new SocketIoTransport({ url: listener.url }), { randomUUID });
    await client.connect();
    assert.deepEqual(await client.listSessions(), []);
    assert((await client.listWorkspaces()).some((workspace) => workspace.kind === 'chat'));

    const terminalId = await client.openTerminal({ cols: 80, rows: 24, shell: '/bin/sh' });
    client.terminalInput(terminalId, 'echo daemon-process-acceptance\n');
    await waitFor(
      () => client?.terminalOutputSnapshot(terminalId).includes('daemon-process-acceptance'),
      50,
      AbortSignal.timeout(10000),
    );
    client.closeTerminal(terminalId);

    const sqlite = new Sqlite(join(home, '.linkcode', 'daemon.db'), { readonly: true });
    const tables = new Set(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name),
    );
    sqlite.close();
    for (const table of ['__drizzle_migrations', 'sessions', 'workspaces', 'schedules', 'loops']) {
      assert(tables.has(table), `missing migrated table ${table}`);
    }

    assert(child.kill('SIGTERM'), 'daemon rejected SIGTERM');
    const shutdown = await waitFor(() => exit ?? false, 50, AbortSignal.timeout(10000));
    assert.deepEqual(shutdown, { code: 0, signal: null });
    assert.equal(existsSync(runtimePath), false, 'runtime.json survived graceful shutdown');

    console.log('PASS daemon startup, discovery, SQLite, Socket.IO, PTY, and graceful shutdown');
  } catch (error) {
    console.error(logs.join('').slice(-8000));
    throw error;
  } finally {
    client?.dispose();
    await stop(child);
    rmSync(home, { recursive: true, force: true });
  }
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    }),
    wait(5000).then(() => child.kill('SIGKILL')),
  ]);
}

void main();
