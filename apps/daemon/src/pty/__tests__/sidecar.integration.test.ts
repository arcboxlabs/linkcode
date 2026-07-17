import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PtyProcess } from '@linkcode/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { SidecarPtyBackend } from '../sidecar';

/**
 * Cross-boundary test: the frame protocol is implemented twice (Rust `proto.rs`, TS `codec.ts`);
 * this runs the real `SidecarPtyBackend` against the real compiled `linkcode-pty` binary so the two
 * must agree on the wire. Skips unless the binary is built (`cargo build -p linkcode-pty`).
 */
const binaryName = process.platform === 'win32' ? 'linkcode-pty.exe' : 'linkcode-pty';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const BINARY =
  [
    process.env.LINKCODE_PTY_SIDECAR_PATH,
    join(repoRoot, 'target', 'debug', binaryName),
    join(repoRoot, 'target', 'release', binaryName),
  ].find((path) => !!path && existsSync(path)) ?? '';

const TIMEOUT_MS = 10000;

/** Resolve once `needle` appears in the terminal output, or reject on timeout. */
function outputContaining(proc: PtyProcess, needle: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${needle}"`)),
      TIMEOUT_MS,
    );
    proc.onData((data) => {
      text += data;
      if (text.includes(needle)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

/** Resolve with the exit code once the terminal exits, or reject on timeout. */
function exitCode(proc: PtyProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for exit')), TIMEOUT_MS);
    proc.onExit((code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe.skipIf(!BINARY)('SidecarPtyBackend against the real linkcode-pty binary', () => {
  let backend: SidecarPtyBackend | null = null;

  afterEach(() => {
    backend?.shutdown();
    backend = null;
  });

  it('round-trips input and output through the real wire protocol', async () => {
    backend = new SidecarPtyBackend(BINARY);
    const proc = await backend.open('term-1', { cols: 80, rows: 24, shell: '/bin/sh' });
    // Subscribe before writing so the echoed marker can't slip through unobserved.
    const seen = outputContaining(proc, 'interop-marker');
    proc.write('echo interop-marker\n');
    await expect(seen).resolves.toBeUndefined();
  });

  it('surfaces the shell exit code through the real EXIT frame', async () => {
    backend = new SidecarPtyBackend(BINARY);
    const proc = await backend.open('term-1', { cols: 80, rows: 24, shell: '/bin/sh' });
    const code = exitCode(proc);
    proc.write('exit 7\n');
    await expect(code).resolves.toBe(7);
  });
});
