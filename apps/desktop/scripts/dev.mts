// Dev orchestration (replaces `electron-vite dev`): build main + preload once, start the
// renderer dev server, then launch Electron with ELECTRON_RENDERER_URL injected (read by
// src/main/window.ts). Renderer changes hot-reload; main/preload changes need a re-run.
// Usage: node scripts/dev.mts [--mode mock] [-- <electron args, e.g. --remote-debugging-port=9222>]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build, createServer } from 'vite';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const separator = args.indexOf('--');
  const ownArgs = separator === -1 ? args : args.slice(0, separator);
  const electronArgs = separator === -1 ? [] : args.slice(separator + 1);
  const modeIndex = ownArgs.indexOf('--mode');
  const mode = modeIndex === -1 ? 'development' : ownArgs[modeIndex + 1];
  if (!mode) throw new Error('--mode requires a value');
  process.env.NODE_ENV ??= 'development';

  const desktopDir = resolve(import.meta.dirname, '..');
  for (const target of ['main', 'preload']) {
    await build({ configFile: resolve(desktopDir, `vite.${target}.config.ts`), mode });
  }

  const server = await createServer({
    configFile: resolve(desktopDir, 'vite.renderer.config.ts'),
    mode,
  });
  await server.listen();
  server.printUrls();
  const rendererUrl = server.resolvedUrls?.local[0];
  if (!rendererUrl) {
    throw new Error('renderer dev server did not resolve a local URL');
  }
  process.env.ELECTRON_RENDERER_URL = rendererUrl;

  const require = createRequire(import.meta.url);
  const electronBinary = require('electron') as unknown as string;
  const electron = spawn(electronBinary, [desktopDir, ...electronArgs], { stdio: 'inherit' });
  electron.on('close', (code) => {
    void server.close().finally(() => {
      process.exit(code ?? 0);
    });
  });
}

void main();
