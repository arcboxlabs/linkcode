import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { falseFn } from 'foxts/noop';
import { wait } from 'foxts/wait';
import { waitFor } from 'foxts/wait-for';
import type { Browser, Page } from 'playwright-core';
import { chromium } from 'playwright-core';

const webviewDir = fileURLToPath(new URL('..', import.meta.url));
const daemonDir = fileURLToPath(new URL('../../daemon', import.meta.url));
const viteCli = fileURLToPath(new URL('../../bin/vite.js', import.meta.resolve('vite')));

interface ViteServer {
  child: ChildProcess;
  exit?: { code: number | null; signal: NodeJS.Signals | null };
  logs: string[];
  origin: string;
}

interface DaemonProcess extends ViteServer {
  home: string;
}

function monitorApplicationErrors(page: Page, appOrigin: string, appErrors: string[]): void {
  page.on('pageerror', (error) => appErrors.push(`pageerror: ${error.stack ?? error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') appErrors.push(`console.error: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    // Cloud/Sentry endpoints are outside this standalone boundary. Same-origin failures are app
    // asset/navigation failures and must close the smoke test immediately at its next assertion.
    if (request.url().startsWith(appOrigin)) {
      appErrors.push(
        `requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`,
      );
    }
  });
}

function assertNoApplicationErrors(appErrors: string[]): void {
  assert.deepEqual(appErrors, [], `Browser application errors:\n${appErrors.join('\n')}`);
}

async function sendPrompt(page: Page, prompt: string, appErrors: string[]): Promise<void> {
  const editor = page.locator('[data-slot="composer-editor"][contenteditable="true"]');
  await editor.waitFor({ state: 'visible' });
  await editor.fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText(`You said: ${prompt}`, { exact: false }).waitFor({ timeout: 15000 });
  assertNoApplicationErrors(appErrors);
}

async function main(): Promise<void> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      throw new Error(
        'Chromium could not be launched. Install it with: pnpm -F @linkcode/webview exec playwright-core install chromium --only-shell',
        { cause: error },
      );
    }

    await verifyProductionEntry(browser);
    await verifyMockEntry(browser);
  } finally {
    await browser?.close();
  }
}

async function verifyProductionEntry(browser: Browser): Promise<void> {
  const daemon = await startDaemon();
  try {
    const server = await startVite(['preview']);
    try {
      const appErrors: string[] = [];
      const context = await browser.newContext();
      await context.addInitScript(
        ({ daemonUrl }) => {
          localStorage.setItem(
            'linkcode.webview.settings:v1',
            JSON.stringify({ state: { daemonUrl }, version: 0 }),
          );
        },
        { daemonUrl: daemon.origin },
      );
      const page = await context.newPage();
      monitorApplicationErrors(page, server.origin, appErrors);
      await page.goto(server.origin, { waitUntil: 'domcontentloaded' });
      await page.locator('#root > *').waitFor();
      await page.getByRole('link', { name: 'Open settings' }).click();
      await page.waitForURL(`${server.origin}/settings`);
      await page.goto(`${server.origin}/settings`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: 'Back' }).waitFor();
      await page.getByRole('link', { name: 'Back' }).click();
      await page.waitForURL(`${server.origin}/`);
      assertNoApplicationErrors(appErrors);
      await context.close();

      process.stdout.write(
        'Webview production bundle smoke passed: daemon connection, assets, and router.\n',
      );
    } finally {
      await stop(server.child);
    }
  } finally {
    await stop(daemon.child);
    rmSync(daemon.home, { force: true, recursive: true });
  }
}

async function verifyMockEntry(browser: Browser): Promise<void> {
  const server = await startVite(['--mode', 'mock']);
  try {
    const appErrors: string[] = [];
    const page = await browser.newPage();
    monitorApplicationErrors(page, server.origin, appErrors);
    await page.goto(server.origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#root > *').waitFor();

    await page.getByRole('link', { name: 'Open settings' }).click();
    await page.waitForURL(`${server.origin}/settings`);
    await page.getByRole('link', { name: 'Back' }).click();
    await page.waitForURL(`${server.origin}/`);

    const threadTitle = 'Wire the workbench to the daemon';
    await page.getByText(threadTitle, { exact: true }).click();
    const firstPrompt = `browser-wire-smoke-${Date.now().toString(36)}`;
    await sendPrompt(page, firstPrompt, appErrors);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(threadTitle, { exact: true }).waitFor();
    await page.getByText(threadTitle, { exact: true }).click();
    const recoveryPrompt = `${firstPrompt}-after-reload`;
    await sendPrompt(page, recoveryPrompt, appErrors);
    assertNoApplicationErrors(appErrors);
    await page.close();

    process.stdout.write(
      'Webview browser smoke passed: router, mock wire prompt, and reload recovery.\n',
    );
  } finally {
    await stop(server.child);
  }
}

async function startDaemon(): Promise<DaemonProcess> {
  const port = await freePort();
  const home = mkdtempSync(join(tmpdir(), 'linkcode-webview-e2e-'));
  const daemon: DaemonProcess = {
    child: spawn(process.execPath, ['--import', './dist/instrument.js', 'dist/index.js'], {
      cwd: daemonDir,
      env: {
        ...process.env,
        HOME: home,
        LINKCODE_HOST: '127.0.0.1',
        LINKCODE_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }),
    home,
    logs: [],
    origin: `http://127.0.0.1:${port}`,
  };
  daemon.child.stdout?.on('data', (chunk: Buffer) => daemon.logs.push(chunk.toString()));
  daemon.child.stderr?.on('data', (chunk: Buffer) => daemon.logs.push(chunk.toString()));
  daemon.child.once('exit', (code, signal) => {
    daemon.exit = { code, signal };
  });
  try {
    await waitFor(
      async () => {
        if (daemon.exit) {
          throw new Error(
            `Daemon exited before serving the app: ${JSON.stringify(daemon.exit)}\n${daemon.logs.join('')}`,
          );
        }
        return fetch(`${daemon.origin}/linkcode`)
          .then((response) => response.ok)
          .catch(falseFn);
      },
      100,
      AbortSignal.timeout(30000),
    );
    return daemon;
  } catch (error) {
    await stop(daemon.child);
    rmSync(home, { force: true, recursive: true });
    throw error;
  }
}

async function startVite(command: string[]): Promise<ViteServer> {
  const port = await freePort();
  const server: ViteServer = {
    child: spawn(
      process.execPath,
      [viteCli, ...command, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      {
        cwd: webviewDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    ),
    logs: [],
    origin: `http://127.0.0.1:${port}`,
  };
  server.child.stdout?.on('data', (chunk: Buffer) => server.logs.push(chunk.toString()));
  server.child.stderr?.on('data', (chunk: Buffer) => server.logs.push(chunk.toString()));
  server.child.once('exit', (code, signal) => {
    server.exit = { code, signal };
  });
  try {
    await waitFor(
      async () => {
        if (server.exit) {
          throw new Error(
            `Vite exited before serving the app: ${JSON.stringify(server.exit)}\n${server.logs.join('')}`,
          );
        }
        return fetch(server.origin)
          .then((response) => response.ok)
          .catch(falseFn);
      },
      100,
      AbortSignal.timeout(30000),
    );
    return server;
  } catch (error) {
    await stop(server.child);
    throw error;
  }
}

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
