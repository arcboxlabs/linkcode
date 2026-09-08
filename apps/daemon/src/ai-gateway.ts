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
   * (`assets.ensure({ kind: 'tool', name: 'aigateway' })`). `LINKCODE_AIGATEWAY_PATH` overrides it for dev / standalone.
   */
  ensureBinary?: () => Promise<string | undefined>;
}

interface SidecarEntry {
  ready: Promise<string>;
  start: () => void;
  close: () => void;
}

const LISTENING_RE = /listening on (http:\/\/127\.0\.0\.1:\d+)/;
const STARTUP_TIMEOUT_MS = 10000;

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
  const running = new Map<string, SidecarEntry>();

  const createEntry = (upstream: TranslatorUpstream, key: string): SidecarEntry => {
    let child: SidecarChildProcess | undefined;
    let dir: string | undefined;
    let timer: NodeJS.Timeout | undefined;
    let buffer = '';
    let stderrTail = '';
    let closed = false;
    let readySettled = false;
    let resolveReady!: (url: string) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<string>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    let entry: SidecarEntry;
    const cleanup = (error?: Error, terminate = false): void => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      if (running.get(key) === entry) running.delete(key);
      if (terminate) child?.kill('SIGTERM');
      if (dir) rmSync(dir, { recursive: true, force: true });
      if (!readySettled) {
        readySettled = true;
        rejectReady(error ?? new Error('aigateway stopped before listening'));
      }
    };

    const start = async (): Promise<void> => {
      try {
        // Env override (dev / standalone) wins; otherwise install-on-demand from the managed store.
        const binary = process.env.LINKCODE_AIGATEWAY_PATH ?? (await ensureBinary?.());
        if (closed) return;
        if (!binary) {
          throw new Error(
            'translation sidecar unavailable: no aigateway binary (set LINKCODE_AIGATEWAY_PATH or install the managed asset)',
          );
        }
        dir = mkdtempSync(join(tmpdir(), 'linkcode-aigw-'));
        const configPath = join(dir, 'config.toml');
        writeFileSync(configPath, upstreamToToml(upstream), { mode: 0o600 });
        child = spawn(binary, [
          'serve',
          '--host',
          '127.0.0.1',
          '--port',
          '0',
          '--config',
          configPath,
        ]);
        child.stdout?.on('data', (chunk) => {
          if (readySettled || closed) return;
          buffer += String(chunk);
          const match = LISTENING_RE.exec(buffer);
          if (match) {
            readySettled = true;
            if (timer) clearTimeout(timer);
            resolveReady(match[1]);
          }
        });
        child.stderr?.on('data', (chunk) => {
          stderrTail = String(chunk);
        });
        child.on('exit', (code) => {
          cleanup(
            readySettled
              ? undefined
              : new Error(
                  `aigateway exited (code ${code ?? 'signal'}) before listening: ${stderrTail.trim()}`,
                ),
          );
        });
        child.on('error', (err) => {
          cleanup(
            new Error(`aigateway failed to start: ${extractErrorMessage(err) ?? 'spawn error'}`),
          );
        });
        timer = setTimeout(() => {
          cleanup(new Error(`aigateway did not become ready within ${STARTUP_TIMEOUT_MS}ms`), true);
        }, STARTUP_TIMEOUT_MS);
        timer.unref();
      } catch (err) {
        cleanup(
          new Error(`aigateway failed to start: ${extractErrorMessage(err) ?? 'unknown error'}`),
        );
      }
    };

    entry = {
      ready,
      start() {
        void start();
      },
      close: () => cleanup(undefined, true),
    };
    return entry;
  };

  return {
    ensure(upstream) {
      const key = hashUpstream(upstream);
      let entry = running.get(key);
      if (!entry) {
        entry = createEntry(upstream, key);
        running.set(key, entry);
        entry.start();
      }
      return entry.ready;
    },
    async closeAll() {
      const entries = [...running.values()];
      for (let i = 0, len = entries.length; i < len; i++) {
        const entry = entries[i];
        entry.close();
      }
      await Promise.allSettled(entries.map((entry) => entry.ready));
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
  return nodeSpawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}
