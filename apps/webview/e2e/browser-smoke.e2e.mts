import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { falseFn } from 'foxts/noop';
import { wait } from 'foxts/wait';
import { waitFor } from 'foxts/wait-for';
import type { Page } from 'playwright-core';
import { chromium } from 'playwright-core';

const appErrors: string[] = [];
const webviewDir = fileURLToPath(new URL('..', import.meta.url));
const viteCli = fileURLToPath(new URL('../../bin/vite.js', import.meta.resolve('vite')));

function monitorApplicationErrors(page: Page, appOrigin: string): void {
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

function assertNoApplicationErrors(): void {
  assert.deepEqual(appErrors, [], `Browser application errors:\n${appErrors.join('\n')}`);
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  const editor = page.locator('[data-slot="composer-editor"][contenteditable="true"]');
  await editor.waitFor({ state: 'visible' });
  await editor.fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText(`You said: ${prompt}`, { exact: false }).waitFor({ timeout: 15000 });
  assertNoApplicationErrors();
}

async function main(): Promise<void> {
  let server: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    const port = await freePort();
    const serverLogs: string[] = [];
    let serverExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    const viteProcess = spawn(
      process.execPath,
      [viteCli, '--mode', 'mock', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      {
        cwd: webviewDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    server = viteProcess;
    viteProcess.stdout.on('data', (chunk: Buffer) => serverLogs.push(chunk.toString()));
    viteProcess.stderr.on('data', (chunk: Buffer) => serverLogs.push(chunk.toString()));
    viteProcess.once('exit', (code, signal) => {
      serverExit = { code, signal };
    });
    const appOrigin = `http://127.0.0.1:${port}`;
    await waitFor(
      async () => {
        if (serverExit) {
          throw new Error(
            `Vite exited before serving the app: ${JSON.stringify(serverExit)}\n${serverLogs.join('')}`,
          );
        }
        return fetch(appOrigin)
          .then((response) => response.ok)
          .catch(falseFn);
      },
      100,
      AbortSignal.timeout(30000),
    );

    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      throw new Error(
        'Chromium could not be launched. Install it with: pnpm -F @linkcode/webview exec playwright-core install chromium --only-shell',
        { cause: error },
      );
    }

    const page = await browser.newPage();
    monitorApplicationErrors(page, appOrigin);
    await page.goto(appOrigin, { waitUntil: 'domcontentloaded' });
    await page.locator('#root > *').waitFor();

    await page.getByRole('link', { name: 'Open settings' }).click();
    await page.waitForURL(`${appOrigin}/settings`);
    await page.getByRole('link', { name: 'Back' }).click();
    await page.waitForURL(`${appOrigin}/`);

    const threadTitle = 'Wire the workbench to the daemon';
    await page.getByText(threadTitle, { exact: true }).click();
    const firstPrompt = `browser-wire-smoke-${Date.now().toString(36)}`;
    await sendPrompt(page, firstPrompt);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(threadTitle, { exact: true }).waitFor();
    await page.getByText(threadTitle, { exact: true }).click();
    const recoveryPrompt = `${firstPrompt}-after-reload`;
    await sendPrompt(page, recoveryPrompt);
    assertNoApplicationErrors();

    process.stdout.write(
      'Webview browser smoke passed: router, mock wire prompt, and reload recovery.\n',
    );
  } finally {
    await browser?.close();
    if (server) await stop(server);
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
