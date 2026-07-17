import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranslatorService, TranslatorUpstream } from '@linkcode/engine';
import { extractErrorMessage } from 'foxts/extract-error-message';

/**
 * Translation sidecar: spawns `arcboxlabs/aigateway` on loopback so a cross-protocol account works
 * offline; `ensure()` resolves or reuses a process per upstream and the engine injects its base
 * URL as the agent's `ANTHROPIC_BASE_URL`.
 *
 * Contract (aigateway `docs/gateway-sidecar.md`): once bound it prints exactly one stdout line —
 * `listening on http://127.0.0.1:<port>` — the only way to learn the OS-assigned port; failure
 * exits non-zero; SIGTERM stops it.
 */

/** The child-process surface {@link createAiGatewaySidecar} needs; node's `spawn` satisfies it. */
export interface SidecarChildProcess {
  stdout: { on: (event: 'data', listener: (chunk: unknown) => void) => void } | null;
  stderr: { on: (event: 'data', listener: (chunk: unknown) => void) => void } | null;
  on(event: 'exit', listener: (code: number | null) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  kill: (signal?: NodeJS.Signals) => void;
}
export type SidecarSpawn = (command: string, args: string[]) => SidecarChildProcess;

export interface AiGatewaySidecarOptions {
  spawn?: SidecarSpawn;
  /**
   * Resolve (installing on demand) the aigateway binary path — wired to the managed-asset store
   * (`assets.ensure('tool:aigateway')`). `LINKCODE_AIGATEWAY_PATH` overrides it for dev / standalone.
   */
  ensureBinary?: () => Promise<string | undefined>;
}

interface Sidecar {
  url: string;
  child: SidecarChildProcess;
  dir: string;
}

const LISTENING_RE = /listening on (http:\/\/127\.0\.0\.1:\d+)/;

/** Serialize an upstream to the aigateway config.toml (only the fields the sidecar reads). */
export function upstreamToToml(upstream: TranslatorUpstream): string {
  const lines = [
    '[upstream]',
    `base_url = ${tomlString(upstream.baseUrl)}`,
    `api_key = ${tomlString(upstream.apiKey)}`,
    `wire = ${tomlString(upstream.wire)}`,
  ];
  if (upstream.model) lines.push(`default_model = ${tomlString(upstream.model)}`);
  return `${lines.join('\n')}\n`;
}

export function createAiGatewaySidecar(options: AiGatewaySidecarOptions = {}): TranslatorService {
  const { spawn = defaultSpawn, ensureBinary } = options;
  const running = new Map<string, Promise<Sidecar>>();

  const start = async (upstream: TranslatorUpstream, key: string): Promise<Sidecar> => {
    // Env override (dev / standalone) wins; otherwise install-on-demand from the managed-asset store.
    const binary = process.env.LINKCODE_AIGATEWAY_PATH ?? (await ensureBinary?.());
    if (!binary) {
      throw new Error(
        'translation sidecar unavailable: no aigateway binary (set LINKCODE_AIGATEWAY_PATH or install the managed asset)',
      );
    }
    const dir = mkdtempSync(join(tmpdir(), 'linkcode-aigw-'));
    const configPath = join(dir, 'config.toml');
    writeFileSync(configPath, upstreamToToml(upstream), { mode: 0o600 });

    const child = spawn(binary, [
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--config',
      configPath,
    ]);

    return new Promise<Sidecar>((resolve, reject) => {
      let buffer = '';
      let settled = false;
      let stderrTail = '';
      child.stdout?.on('data', (chunk) => {
        if (settled) return;
        buffer += String(chunk);
        const match = LISTENING_RE.exec(buffer);
        if (match) {
          settled = true;
          resolve({ url: match[1], child, dir });
        }
      });
      child.stderr?.on('data', (chunk) => {
        stderrTail = String(chunk);
      });
      child.on('exit', (code) => {
        running.delete(key);
        rmSync(dir, { recursive: true, force: true });
        if (!settled) {
          settled = true;
          reject(
            new Error(
              `aigateway exited (code ${code ?? 'signal'}) before listening: ${stderrTail.trim()}`,
            ),
          );
        }
      });
      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(
            new Error(`aigateway failed to start: ${extractErrorMessage(err) ?? 'spawn error'}`),
          );
        }
      });
    });
  };

  return {
    ensure(upstream) {
      const key = hashUpstream(upstream);
      let pending = running.get(key);
      if (!pending) {
        pending = start(upstream, key);
        running.set(key, pending);
        // A failed start must not stick: drop it so the next session can respawn.
        pending.catch(() => running.delete(key));
      }
      return pending.then((sidecar) => sidecar.url);
    },
    async closeAll() {
      const pending = [...running.values()];
      running.clear();
      const settled = await Promise.allSettled(pending);
      for (const result of settled) {
        if (result.status === 'fulfilled') result.value.child.kill('SIGTERM');
      }
    },
  };
}

function hashUpstream(upstream: TranslatorUpstream): string {
  return createHash('sha256').update(JSON.stringify(upstream)).digest('hex');
}

function tomlString(value: string): string {
  // A TOML basic string escapes the same characters as a JSON string (`"`, `\`, control chars,
  // `\uXXXX`), so JSON.stringify produces a valid one.
  return JSON.stringify(value);
}

function defaultSpawn(command: string, args: string[]): SidecarChildProcess {
  return nodeSpawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}
