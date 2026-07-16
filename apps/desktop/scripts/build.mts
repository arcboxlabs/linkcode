// Production build of all three Vite targets (replaces `electron-vite build`). `--mode` flows into
// import.meta.env.MODE, which src/main/constants.ts uses for channel detection
// (production default / devshell / development / mock).
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'vite';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { mode: { type: 'string' } } });
  const mode = values.mode ?? 'production';
  process.env.NODE_ENV ??= 'production';

  const desktopDir = resolve(import.meta.dirname, '..');
  // Main goes first: its closeBundle stages out/daemon + out/drizzle, matching electron-vite's
  // main → preload → renderer order.
  for (const target of ['main', 'preload', 'renderer']) {
    await build({ configFile: resolve(desktopDir, `vite.${target}.config.ts`), mode });
  }
}

void main();
