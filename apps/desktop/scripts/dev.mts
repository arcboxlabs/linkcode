// Dev orchestration (replaces `electron-vite dev`): build main + preload once, start the renderer
// dev server, launch Electron with ELECTRON_RENDERER_URL injected (read by src/main/window.ts).
// Renderer changes hot-reload; main/preload changes need a re-run. Extra args go to Electron.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build, createServer } from 'vite';

async function main(): Promise<void> {
  // `pnpm run` forwards extra args with or without the `--` separator, so forward everything
  // except --mode to Electron instead of position-gating on the separator (which would silently
  // drop flags like --profile / --remote-debugging-port).
  const args = process.argv.slice(2);
  const electronArgs: string[] = [];
  let mode = 'development';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') continue;
    if (arg === '--mode') {
      const value = args[++i];
      if (!value) throw new Error('--mode requires a value');
      mode = value;
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length);
      if (!mode) throw new Error('--mode requires a value');
    } else {
      electronArgs.push(arg);
    }
  }
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
