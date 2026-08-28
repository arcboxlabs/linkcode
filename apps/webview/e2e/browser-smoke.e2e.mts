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
const newSessionDefaultsKey = 'linkcode.workbench.new-session-defaults:v7';
const mockThreadTitle = 'Wire the workbench to the daemon';
const mockChatThreadTitle = 'Prototype without git';
const showcaseThreadTitle = 'Mocked streaming showcase';
const longThreadTitle = 'Long thread · navigation testbed';
const longThreadTurns = 48;
const maxMountedRows = 10;
const RE_ACTIVITY_RUN_DETAILS =
  /^Activity details: .*failed.*ran .*command.*made .*file change.*explored.*$/iu;
const RE_LONG_THREAD_TURN = /Turn (\d+) —/g;

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
    // Chromium reports route-change cancellations as ERR_ABORTED while the Vite module graph is
    // still loading; a required canceled module is covered by the subsequent UI assertion.
    const errorText = request.failure()?.errorText ?? 'unknown';
    if (errorText !== 'net::ERR_ABORTED' && request.url().startsWith(appOrigin)) {
      appErrors.push(`requestfailed: ${request.method()} ${request.url()} (${errorText})`);
    }
  });
}

function assertNoApplicationErrors(appErrors: string[]): void {
  assert.deepEqual(appErrors, [], `Browser application errors:\n${appErrors.join('\n')}`);
}

async function selectMockThread(page: Page): Promise<void> {
  await page.locator('[data-thread-title]', { hasText: mockThreadTitle }).click();
  await page.locator('[data-conversation-title]', { hasText: mockThreadTitle }).waitFor();
}

async function sendPrompt(page: Page, prompt: string, appErrors: string[]): Promise<void> {
  const editor = page.locator('[data-slot="composer-editor"][contenteditable="true"]');
  await editor.waitFor({ state: 'visible' });
  await editor.fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText(`You said: ${prompt}`, { exact: false }).waitFor({ timeout: 15000 });
  assertNoApplicationErrors(appErrors);
}

async function verifyNewChatIsolation(page: Page, appErrors: string[]): Promise<void> {
  // Must track NEW_SESSION_DEFAULTS_STORAGE_KEY and its schema: a stale blob is discarded silently,
  // the new chat falls back to claude-code, and its `missing` mock runtime blocks Send forever.
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ state: { lastHarness: 'pi' }, version: 0 }));
  }, newSessionDefaultsKey);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-thread-title]', { hasText: mockChatThreadTitle }).waitFor();
  await page.locator('[data-thread-title]', { hasText: mockChatThreadTitle }).click();
  await page.locator('[data-conversation-title]', { hasText: mockChatThreadTitle }).waitFor();
  await page.getByRole('button', { name: 'New chat' }).click();

  const prompt = `new-chat-isolation-${Date.now().toString(36)}`;
  const editor = page.locator('[data-slot="composer-editor"][contenteditable="true"]');
  await editor.waitFor({ state: 'visible' });
  await editor.fill(prompt);
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) throw new Error('Missing workbench main');
    const titles = new Set<string | null>();
    const collect = (): void => {
      titles.add(document.querySelector('[data-conversation-title]')?.textContent ?? null);
    };
    const observer = new MutationObserver(collect);
    observer.observe(main, { childList: true, characterData: true, subtree: true });
    Reflect.set(window, '__newChatIsolationProbe', () => {
      collect();
      observer.disconnect();
      return [...titles];
    });
  });

  const send = page.getByRole('button', { name: 'Send' });
  if (await send.isDisabled()) {
    throw new Error(
      `New chat cannot send: the ${newSessionDefaultsKey} seed did not resolve a sendable harness. ` +
        'Check the storage key version and the persisted field names against new-session-defaults-store.ts.',
    );
  }
  await send.click();
  await page.getByText(`You said: ${prompt}`, { exact: false }).waitFor({ timeout: 15000 });
  const titles = await page.evaluate(() => {
    const finish = Reflect.get(window, '__newChatIsolationProbe') as
      | undefined
      | (() => Array<string | null>);
    if (!finish) throw new Error('Missing new-chat isolation probe');
    Reflect.deleteProperty(window, '__newChatIsolationProbe');
    return finish();
  });
  assert.equal(
    titles.some((title) => title?.includes(mockChatThreadTitle)),
    false,
    `New chat rendered the previous conversation after submission: ${JSON.stringify(titles)}`,
  );
  assertNoApplicationErrors(appErrors);
}

async function verifyActivityRunHierarchy(page: Page): Promise<void> {
  await page.locator('[data-thread-title]', { hasText: showcaseThreadTitle }).click();
  await page.locator('[data-conversation-title]', { hasText: showcaseThreadTitle }).waitFor();

  const runHeader = page.getByRole('button', {
    name: RE_ACTIVITY_RUN_DETAILS,
  });
  await runHeader.waitFor({ timeout: 15000 });
  await runHeader.click();

  const metrics = await runHeader.evaluate((header) => {
    const group = header.closest('[data-slot="collapsible"]');
    const body = group?.querySelector(
      ':scope > [data-slot="collapsible-panel"] [data-slot="scroll-area-content"] > div',
    );
    if (!(body instanceof HTMLElement)) throw new Error('Missing expanded activity body');

    const children = Array.from(body.children, (row) => {
      const child = row.firstElementChild;
      if (!(child instanceof HTMLElement)) throw new Error('Missing activity child header');
      return {
        paddingBlockStart: Number.parseFloat(getComputedStyle(child).paddingBlockStart),
        slot: child.dataset.slot,
        tagName: child.tagName,
      };
    });
    return {
      children,
      paddingBlockStart: Number.parseFloat(getComputedStyle(header).paddingBlockStart),
    };
  });

  assert.ok(metrics.children.length >= 5, 'Mixed activity run did not render every child');
  assert.ok(
    metrics.children.some((child) => child.slot === 'tooltip-trigger'),
    `No tooltip-backed activity row rendered: ${JSON.stringify(metrics.children)}`,
  );
  assert.ok(
    metrics.children.some((child) => child.tagName === 'DIV'),
    `No bodyless activity row rendered: ${JSON.stringify(metrics.children)}`,
  );
  assert.ok(
    metrics.children.every(
      (child) => child.paddingBlockStart > 0 && child.paddingBlockStart < metrics.paddingBlockStart,
    ),
    `Activity children were not denser than the group: ${JSON.stringify(metrics)}`,
  );
}

async function verifyLongThreadVirtualization(page: Page): Promise<void> {
  await page.evaluate(
    ({ flags, source }) => {
      const host = document.querySelector('main');
      if (!host) throw new Error('Missing workbench main');

      const turnPattern = new RegExp(source, flags);
      const mountedTurns = new Set<number>();
      const collect = (node: Node): void => {
        for (const match of (node.textContent ?? '').matchAll(turnPattern)) {
          mountedTurns.add(Number(match[1]));
        }
      };
      const process = (records: MutationRecord[]): void => {
        for (const record of records) {
          for (const node of record.addedNodes) collect(node);
        }
      };
      const observer = new MutationObserver(process);
      observer.observe(host, { childList: true, subtree: true });
      Reflect.set(window, '__longThreadMountProbe', () => {
        process(observer.takeRecords());
        observer.disconnect();
        return [...mountedTurns];
      });
    },
    { flags: RE_LONG_THREAD_TURN.flags, source: RE_LONG_THREAD_TURN.source },
  );

  const firstPaint = await page.evaluate(
    ({ lastTurn, title }) =>
      new Promise<{
        bottomGap: number | null;
        conversationTitle: string | null;
        tailMounted: boolean;
      }>((resolve, reject) => {
        const frameId = requestAnimationFrame(() => {
          try {
            const thread = [...document.querySelectorAll('[data-thread-title]')].find((element) =>
              element.textContent.includes(title),
            );
            if (!(thread instanceof HTMLElement)) throw new Error(`Missing thread: ${title}`);
            thread.click();
            queueMicrotask(() => {
              try {
                const conversationTitle =
                  document.querySelector('[data-conversation-title]')?.textContent ?? null;
                const scroll = document.querySelector('[role="log"]')?.firstElementChild;
                const content = scroll?.firstElementChild;
                if (!(scroll instanceof HTMLElement) || !(content instanceof HTMLElement)) {
                  throw new TypeError('Missing long-thread scroll surface');
                }

                const observer = new IntersectionObserver(
                  ([entry]) => {
                    observer.disconnect();
                    resolve({
                      bottomGap: entry.rootBounds
                        ? entry.boundingClientRect.bottom - entry.rootBounds.bottom
                        : null,
                      conversationTitle,
                      tailMounted: content.textContent.includes(`Turn ${lastTurn} —`),
                    });
                  },
                  { root: scroll },
                );
                observer.observe(content);
              } catch (error) {
                reject(new Error('Could not observe first conversation paint', { cause: error }));
              }
            });
          } catch (error) {
            reject(new Error('Could not select the long thread', { cause: error }));
          }
        });
        void frameId;
      }),
    { lastTurn: longThreadTurns, title: longThreadTitle },
  );
  assert.ok(
    firstPaint.conversationTitle?.includes(longThreadTitle),
    `First paint still showed ${JSON.stringify(firstPaint.conversationTitle)}`,
  );
  assert.ok(firstPaint.tailMounted, 'First paint did not show the long-thread tail');
  assert.ok(
    firstPaint.bottomGap !== null && Math.abs(firstPaint.bottomGap) <= 2,
    `First paint opened ${String(firstPaint.bottomGap)}px above bottom`,
  );
  await page.locator('[data-conversation-title]', { hasText: longThreadTitle }).waitFor();
  await page.waitForFunction((lastTurn) => {
    const scroll = document.querySelector('[role="log"]')?.firstElementChild;
    const virtualizer = scroll?.firstElementChild?.firstElementChild;
    return (
      scroll instanceof HTMLElement &&
      scroll.scrollHeight > scroll.clientHeight &&
      (virtualizer?.childElementCount ?? Number.POSITIVE_INFINITY) < 10 &&
      virtualizer?.textContent.includes(`Turn ${lastTurn} —`)
    );
  }, longThreadTurns);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  const metrics = await page.getByRole('log').evaluate((root) => {
    const scroll = root.firstElementChild as HTMLElement;
    const virtualizer = scroll.firstElementChild?.firstElementChild;
    return {
      bottomDifference: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
      mountedRows: virtualizer?.childElementCount,
    };
  });
  const mountedDuringSwitch = await page.evaluate(() => {
    const finish = Reflect.get(window, '__longThreadMountProbe') as undefined | (() => number[]);
    if (!finish) throw new Error('Missing long-thread mount probe');
    Reflect.deleteProperty(window, '__longThreadMountProbe');
    return finish();
  });
  assert.ok(
    metrics.bottomDifference <= 2,
    `Long thread opened ${metrics.bottomDifference}px above bottom`,
  );
  assert.ok(
    (metrics.mountedRows ?? 0) < maxMountedRows,
    `Long thread mounted ${metrics.mountedRows} rows`,
  );
  assert.ok(
    mountedDuringSwitch.includes(longThreadTurns),
    'Long thread tail was not observed during the switch',
  );
  assert.ok(
    mountedDuringSwitch.length < maxMountedRows,
    `Long thread mounted ${mountedDuringSwitch.length} distinct turns while switching`,
  );
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
      await context.route('**/auth/get-session', async (route) => {
        await route.fulfill({ body: 'null', contentType: 'application/json', status: 200 });
      });
      const page = await context.newPage();
      monitorApplicationErrors(page, server.origin, appErrors);
      await page.goto(server.origin, { waitUntil: 'domcontentloaded' });
      await page.locator('#root > *').waitFor();
      await page.getByRole('link', { name: 'Open settings' }).click();
      await page.waitForURL(`${server.origin}/settings`);
      await page.goto(`${server.origin}/settings/billing`, { waitUntil: 'domcontentloaded' });
      await page
        .getByText(
          'To manage top-ups, orders, subscriptions, and checkout, use LinkCode Cloud on the web.',
        )
        .waitFor();
      await page.getByText('Sign in to LinkCode Cloud to view your balance.').waitFor();
      await page.getByRole('button', { name: 'Sign in to LinkCode Cloud' }).waitFor();
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
  const mockDist = mkdtempSync(join(tmpdir(), 'linkcode-webview-mock-e2e-'));
  let server: ViteServer | undefined;
  try {
    await buildMockArtifact(mockDist);
    server = await startVite(['preview', '--outDir', mockDist]);
    const appErrors: string[] = [];
    const page = await browser.newPage();
    monitorApplicationErrors(page, server.origin, appErrors);
    await page.addInitScript(() => {
      if (localStorage.getItem('linkcode.workbench.appearance:v2') !== null) return;
      localStorage.setItem(
        'linkcode.workbench.appearance:v2',
        JSON.stringify({
          state: { reduceMotion: false, smoothConversationScrolling: false },
          version: 0,
        }),
      );
    });
    await page.goto(server.origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#root > *').waitFor();

    await page.getByRole('link', { name: 'Open settings' }).click();
    await page.waitForURL(`${server.origin}/settings`);
    await page.getByRole('link', { name: 'Appearance' }).click();
    await page.waitForURL(`${server.origin}/settings/appearance`);
    const smoothConversationSwitch = page.getByRole('switch', {
      name: 'Smooth conversation follow',
    });
    assert.equal(await smoothConversationSwitch.getAttribute('aria-checked'), 'false');
    await smoothConversationSwitch.click();
    assert.equal(await smoothConversationSwitch.getAttribute('aria-checked'), 'true');
    await smoothConversationSwitch.click();
    assert.equal(await smoothConversationSwitch.getAttribute('aria-checked'), 'false');
    await page.getByRole('link', { name: 'Back' }).click();
    await page.waitForURL(`${server.origin}/`);

    await selectMockThread(page);
    const firstPrompt = `browser-wire-smoke-${Date.now().toString(36)}`;
    await sendPrompt(page, firstPrompt, appErrors);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-thread-title]', { hasText: mockThreadTitle }).waitFor();
    await selectMockThread(page);
    const recoveryPrompt = `${firstPrompt}-after-reload`;
    await sendPrompt(page, recoveryPrompt, appErrors);
    await verifyNewChatIsolation(page, appErrors);
    await verifyActivityRunHierarchy(page);
    await verifyLongThreadVirtualization(page);
    assertNoApplicationErrors(appErrors);
    await page.close();

    process.stdout.write(
      'Webview bundled mock smoke passed: router, wire prompt, and reload recovery.\n',
    );
  } catch (error) {
    throw new Error(`Bundled mock boundary failed:\n${server?.logs.join('') ?? ''}`, {
      cause: error,
    });
  } finally {
    if (server) await stop(server.child);
    rmSync(mockDist, { force: true, recursive: true });
  }
}

async function buildMockArtifact(outDir: string): Promise<void> {
  const logs: string[] = [];
  const child = spawn(
    process.execPath,
    [viteCli, 'build', '--mode', 'mock', '--outDir', outDir, '--emptyOutDir'],
    {
      cwd: webviewDir,
      // The mock transport is intentionally guarded by import.meta.env.DEV. A development-mode
      // bundle preserves that boundary while avoiding Vite's cold dev-server optimizer entirely.
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180000,
      windowsHide: true,
    },
  );
  child.stdout.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    },
  );
  assert.equal(result.code, 0, `Mock bundle failed: ${JSON.stringify(result)}\n${logs.join('')}`);
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
