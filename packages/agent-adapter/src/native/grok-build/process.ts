import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { env as processEnv } from 'node:process';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { GrokStreamEvent } from './map';
import { parseGrokStreamLine } from './map';

const STDERR_TAIL_LIMIT = 2048;

export type GrokEffort = 'low' | 'medium' | 'high';

export interface GrokHeadlessRunOptions {
  binaryPath: string;
  cwd: string;
  prompt: string;
  model?: string;
  effort?: GrokEffort;
  resumeSessionId?: string;
  /** Extra env merged over the inherited process env (e.g. XAI_API_KEY). */
  env?: Record<string, string>;
  onEvent: (event: GrokStreamEvent) => void;
}

export interface GrokHeadlessRun {
  /** Resolves when the process and its stdio streams close. */
  done: Promise<{ exitCode: number | null; stderrTail: string }>;
  kill: () => void;
}

/**
 * Spawn one headless Grok Build turn and stream `--output-format streaming-json` NDJSON lines.
 * Not ACP — each prompt is a separate process; multi-turn uses `--resume <sessionId>`.
 *
 * Verified spawn shape on grok 0.2.102:
 *   grok --no-auto-update -p <prompt> --cwd <cwd> --output-format streaming-json
 *       --permission-mode bypassPermissions [-m …] [--reasoning-effort …] [--resume …]
 */
export function runGrokHeadless(opts: GrokHeadlessRunOptions): GrokHeadlessRun {
  const args = [
    '--no-auto-update',
    '-p',
    opts.prompt,
    '--cwd',
    opts.cwd,
    '--output-format',
    'streaming-json',
    // Headless cannot wait for interactive approval; without bypass, tool calls that would
    // prompt are cancelled and reported to the model (docs/permissions).
    '--permission-mode',
    'bypassPermissions',
  ];
  if (opts.model) args.push('-m', opts.model);
  if (opts.effort) args.push('--reasoning-effort', opts.effort);
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);

  const child = spawn(opts.binaryPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...processEnv,
      GROK_DISABLE_AUTOUPDATER: '1',
      ...opts.env,
    },
  });

  return attachGrokHeadlessChild(child, opts.onEvent);
}

/** Test seam: drive the same line protocol against an already-spawned (or fake) child. */
export function attachGrokHeadlessChild(
  child: ChildProcess,
  onEvent: (event: GrokStreamEvent) => void,
): GrokHeadlessRun {
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (!stdout || !stderr) {
    throw new Error('grok-build: headless child must expose stdout and stderr pipes');
  }

  let stderrTail = '';
  let killed = false;
  const out: Readable = stdout;
  const err: Readable = stderr;

  err.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
  });

  const rl = createInterface({ input: out });
  rl.on('line', (line) => {
    const event = parseGrokStreamLine(line);
    if (event) onEvent(event);
  });

  const done = new Promise<{ exitCode: number | null; stderrTail: string }>((resolve, reject) => {
    child.once('error', (spawnErr) => {
      rl.close();
      reject(spawnErr);
    });
    child.once('close', (code) => {
      resolve({ exitCode: code, stderrTail: stderrTail.trim() });
    });
  });

  return {
    done,
    kill() {
      if (killed) return;
      killed = true;
      child.kill();
    },
  };
}
