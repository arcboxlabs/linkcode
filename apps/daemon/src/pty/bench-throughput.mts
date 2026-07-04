/* eslint-disable no-console, no-await-in-loop -- Benchmark script reports results and runs samples sequentially. */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ERROR, EXIT, FrameDecoder, OPEN, OPENED, OUTPUT, writeFrame } from './codec';
import { binaryName } from './sidecar';

const BYTES = readPositiveInteger('LINKCODE_PTY_BENCH_BYTES', 8 * 1024 * 1024);
const RUNS = readPositiveInteger('LINKCODE_PTY_BENCH_RUNS', 5);
const WARMUP_RUNS = readPositiveInteger('LINKCODE_PTY_BENCH_WARMUP_RUNS', 1);
const COLS = 120;
const ROWS = 32;

interface NodePtyProcess {
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: () => void): { dispose(): void };
  kill(): void;
}

interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: NodeJS.ProcessEnv;
    },
  ): NodePtyProcess;
}

async function main(): Promise<void> {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const sidecarPath =
    process.env.LINKCODE_PTY_SIDECAR_PATH ?? join(repoRoot, 'target', 'release', binaryName());
  const workload = workloadSource(BYTES);

  console.log(
    `PTY throughput benchmark: ${formatBytes(BYTES)} payload, ${RUNS} measured runs, ${WARMUP_RUNS} warmup`,
  );
  console.log(`Rust sidecar: ${sidecarPath}`);

  const sidecar = await runLinkCodePty(sidecarPath, repoRoot, workload);
  printSummary('linkcode-pty', sidecar);

  const nodePty = await loadNodePty();
  if (!nodePty) {
    console.log('node-pty: skipped (package is not installed in this workspace)');
    return;
  }

  const nodePtyResults = await runNodePty(nodePty, repoRoot, workload);
  printSummary('node-pty', nodePtyResults);
}

async function runLinkCodePty(
  sidecarPath: string,
  cwd: string,
  workload: string,
): Promise<number[]> {
  const child = spawn(sidecarPath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  const decoder = new FrameDecoder();
  const pending = new Map<string, { resolve(ms: number): void; reject(error: Error): void }>();

  child.stdout.on('data', (chunk: Buffer) => {
    for (const frame of decoder.feed(chunk)) {
      switch (frame.type) {
        case OPENED:
        case OUTPUT:
          break;
        case EXIT: {
          const { terminalId } = JSON.parse(frame.body.toString('utf8')) as { terminalId: string };
          const waiter = pending.get(terminalId);
          if (!waiter) break;
          pending.delete(terminalId);
          waiter.resolve(performance.now());
          break;
        }
        case ERROR: {
          const { terminalId, message } = JSON.parse(frame.body.toString('utf8')) as {
            terminalId: string;
            message: string;
          };
          const waiter = pending.get(terminalId);
          if (!waiter) break;
          pending.delete(terminalId);
          waiter.reject(new Error(message));
          break;
        }
        default:
          break;
      }
    }
  });

  try {
    const results: number[] = [];
    for (let run = -WARMUP_RUNS; run < RUNS; run += 1) {
      const terminalId = `bench-${run}`;
      const started = performance.now();
      const finished = new Promise<number>((resolve, reject) => {
        pending.set(terminalId, { resolve, reject });
      });
      writeFrame(
        child.stdin,
        OPEN,
        Buffer.from(
          JSON.stringify({
            terminalId,
            cols: COLS,
            rows: ROWS,
            cmd: process.execPath,
            args: ['-e', workload],
            cwd,
            env: {},
          }),
        ),
      );
      const elapsed = (await finished) - started;
      if (run >= 0) results.push(elapsed);
    }
    return results;
  } finally {
    child.kill();
  }
}

async function runNodePty(
  nodePty: NodePtyModule,
  cwd: string,
  workload: string,
): Promise<number[]> {
  const results: number[] = [];
  for (let run = -WARMUP_RUNS; run < RUNS; run += 1) {
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const pty = nodePty.spawn(process.execPath, ['-e', workload], {
        name: 'xterm-256color',
        cols: COLS,
        rows: ROWS,
        cwd,
        env: process.env,
      });
      pty.onData(discardData);
      pty.onExit(() => resolve());
    });
    const elapsed = performance.now() - started;
    if (run >= 0) results.push(elapsed);
  }
  return results;
}

function workloadSource(bytes: number): string {
  return `const total = ${bytes};
const chunk = Buffer.allocUnsafe(64 * 1024).fill(120);
let remaining = total;
while (remaining > 0) {
  const n = Math.min(remaining, chunk.length);
  process.stdout.write(chunk.subarray(0, n));
  remaining -= n;
}`;
}

async function loadNodePty(): Promise<NodePtyModule | null> {
  try {
    const packageName = 'node-pty';
    return (await import(packageName)) as NodePtyModule;
  } catch {
    return null;
  }
}

function printSummary(name: string, samples: number[]): void {
  const sorted = samples.toSorted((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mibPerSecond = BYTES / 1024 / 1024 / (median / 1000);
  console.log(
    `${name}: median ${median.toFixed(1)} ms, ${mibPerSecond.toFixed(1)} MiB/s (${samples
      .map((sample) => sample.toFixed(1))
      .join(', ')} ms)`,
  );
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function discardData(data: string): void {
  void data;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
