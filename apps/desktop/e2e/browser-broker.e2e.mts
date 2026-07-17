/**
 * Browser broker E2E (CODE-267): boots an isolated daemon + the built desktop app (which
 * registers itself as the browser host), then drives the broker as a raw wire client —
 * `browser.execute` ops must round-trip daemon → desktop webview executor → back. Also asserts
 * the closed host-unavailable error once the desktop quits.
 * Run `pnpm -F @linkcode/desktop e2e:browser-broker` after building daemon and desktop.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import type { ElectronApplication } from 'playwright-core';
import { _electron } from 'playwright-core';
import { io } from 'socket.io-client';

const require = createRequire(import.meta.url);
const desktopDir = resolve(import.meta.dirname, '..');
const daemonDir = resolve(desktopDir, '../daemon');
const electronBinary = require('electron') as unknown as string;

const PORT = 45000 + (process.pid % 1000);
const PROFILE = `e2e-broker-${process.pid}`;
/** Must match packages/schema/src/wire (Invariant 1 — a drift silently drops every frame). */
const WIRE_VERSION = 38;

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function waitForDaemon(): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/socket.io/?EIO=4&transport=polling`);
      return;
    } catch {
      await wait(250);
    }
  }
  fail(`daemon did not come up on port ${PORT}`);
}

interface WireFrame {
  v: number;
  id: string;
  ts: number;
  payload: Record<string, unknown>;
}

function createWireClient(): {
  send: (payload: Record<string, unknown>) => void;
  next: (
    predicate: (payload: Record<string, unknown>) => boolean,
  ) => Promise<Record<string, unknown>>;
  close: () => void;
} {
  const socket = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'] });
  let seq = 0;
  const backlog: Record<string, unknown>[] = [];
  const waiters: {
    predicate: (payload: Record<string, unknown>) => boolean;
    resolve: (payload: Record<string, unknown>) => void;
  }[] = [];
  socket.on('frame', (frame: WireFrame) => {
    const index = waiters.findIndex((waiter) => waiter.predicate(frame.payload));
    if (index === -1) {
      backlog.push(frame.payload);
      return;
    }
    const [waiter] = waiters.splice(index, 1);
    waiter.resolve(frame.payload);
  });
  return {
    send(payload) {
      seq += 1;
      socket.emit('frame', { v: WIRE_VERSION, id: `e2e-${seq}`, ts: Date.now(), payload });
    },
    next(predicate) {
      const buffered = backlog.findIndex((payload) => predicate(payload));
      if (buffered !== -1) return Promise.resolve(backlog.splice(buffered, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('wire wait timed out')), 20000);
        waiters.push({
          predicate,
          resolve(payload) {
            clearTimeout(timer);
            resolve(payload);
          },
        });
      });
    },
    close() {
      socket.close();
    },
  };
}

async function execute(
  client: ReturnType<typeof createWireClient>,
  reqId: string,
  op: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  client.send({ kind: 'browser.execute', clientReqId: reqId, op, args });
  const reply = await client.next(
    (payload) => payload.kind === 'browser.executed' && payload.replyTo === reqId,
  );
  return reply.result as Record<string, unknown>;
}

async function main(): Promise<void> {
  if (!existsSync(join(daemonDir, 'dist/index.js'))) {
    fail('apps/daemon/dist is missing — run `pnpm -F @linkcode/daemon build` first');
  }
  if (!existsSync(join(desktopDir, 'out/main/index.js'))) {
    fail('apps/desktop/out is missing — run `pnpm -F @linkcode/desktop build` first');
  }

  const home = mkdtempSync(join(tmpdir(), 'linkcode-e2e-home-'));
  let daemon: ChildProcess | null = null;
  let app: ElectronApplication | null = null;
  let client: ReturnType<typeof createWireClient> | null = null;
  let passed = false;
  try {
    daemon = spawn(process.execPath, ['dist/index.js'], {
      cwd: daemonDir,
      env: {
        ...process.env,
        HOME: home,
        LINKCODE_PORT: String(PORT),
        LINKCODE_PROFILE: PROFILE,
        LINKCODE_BROWSER_TOOLS: '1',
      },
      stdio: 'ignore',
    });
    await waitForDaemon();
    console.log(`daemon up on :${PORT}`);

    app = await _electron.launch({
      executablePath: electronBinary,
      args: [desktopDir, '--use-mock-keychain', '--lang=en-US'],
      env: { ...process.env, HOME: home, LINKCODE_PROFILE: PROFILE },
    });
    const win = await app.firstWindow();
    await win.locator('textarea').first().waitFor({ state: 'visible', timeout: 30000 });
    // Give the workbench a beat to register itself as the browser host.
    await win.waitForTimeout(2000);

    client = createWireClient();
    client.send({ kind: 'ping' });
    await client.next((payload) => payload.kind === 'pong');
    console.log('wire client handshake ok');

    // tabs.open drives the desktop store; the seeded tab list must come back with the new tab.
    const opened = await execute(client, 'r-open', 'tabs.open', {
      url: 'https://example.com/',
    });
    if (opened.ok !== true) fail(`tabs.open failed: ${JSON.stringify(opened)}`);
    const tabs = opened.data as { id: string; url: string | null; active: boolean }[];
    const active = tabs.find((tab) => tab.active);
    if (active?.url !== 'https://example.com/') {
      fail(`expected an active example.com tab, got ${JSON.stringify(tabs)}`);
    }
    const activeTabId = active.id;
    console.log(`tabs.open round-tripped through the desktop executor (${tabs.length} tabs)`);

    // Let the new tab's webview mount (it registers with the executor on render).
    await wait(2000);
    const invalid = await execute(client, 'r-bad', 'tab.click', { tabId: activeTabId, ref: '@e1' });
    if (invalid.ok !== false) fail('tab.click without a snapshot should fail');
    const error = invalid.error as { code: string };
    if (error.code !== 'stale-ref') fail(`expected stale-ref, got ${JSON.stringify(error)}`);
    console.log('ref discipline enforced (stale-ref without a snapshot)');

    // Quit the desktop: the broker must degrade to the closed host-unavailable code.
    await app.close();
    app = null;
    await wait(1000);
    const offline = await execute(client, 'r-offline', 'tabs.list', {});
    if (offline.ok !== false) fail('tabs.list should fail once the host quit');
    const offlineError = offline.error as { code: string };
    if (offlineError.code !== 'host-unavailable') {
      fail(`expected host-unavailable, got ${JSON.stringify(offlineError)}`);
    }
    console.log('host disconnect degrades to host-unavailable');

    passed = true;
    console.log('PASS');
  } finally {
    client?.close();
    await app?.close().catch(noop);
    daemon?.kill('SIGTERM');
    rmSync(join(homedir(), 'Library/Application Support', `LinkCode Development (${PROFILE})`), {
      recursive: true,
      force: true,
    });
    if (passed) {
      rmSync(home, { recursive: true, force: true });
    } else {
      console.error(`kept for debugging: HOME=${home}`);
      process.exitCode = 1;
    }
  }
}

void main();
