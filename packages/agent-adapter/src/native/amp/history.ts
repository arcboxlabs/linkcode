import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process, { env } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { AgentHistoryEvent, AgentHistoryId, AgentHistorySession } from '@linkcode/schema';
import {
  asHistoryId,
  compactRecord,
  cursorFromFetched,
  cursorFromTotal,
  firstText,
  isRecord,
  numberField,
  previewText,
  stringField,
  textFromUnknown,
  textHistoryEvent,
  timestampMs,
} from '../../history-util';

const execFileAsync = promisify(execFile);

/**
 * Amp thread history lives on Sourcegraph's backend, not on disk (no local cache exists), and the
 * SDK wraps only `threads.new`/`threads.markdown`. Listing and structured reads exist solely as
 * CLI subcommands — `amp threads list --json` and `amp threads export <id>` — which are
 * UNDOCUMENTED in the public manual (verified live against the legacy `@sourcegraph/amp` CLI; the
 * pinned build is exact and mandatory — `@sourcegraph/amp-sdk` depends on `@sourcegraph/amp:latest`,
 * which redirects to the neo package, so a `pnpm-workspace.yaml` override forces the legacy build —
 * re-verify the subcommands on every bump, they can be renamed without notice). Every call here is
 * an authenticated network round-trip; auth comes from the CLI's own login state or an ambient
 * `AMP_API_KEY` (history ops run without `StartOptions`, so the per-session config key cannot reach
 * them).
 *
 * Replay is text-only for now, like codex's: the export's message/content block shapes have not
 * been verified against a live paid account, so tool-call replay stays off until they are.
 */

interface AmpCommand {
  command: string;
  args: string[];
}

/** The legacy `@sourcegraph/amp` bin is a JS bundle (`dist/main.js`), so a resolved `.js` path must
 * run as `node <path>` — a bare `execFile` of it fails on Windows and is unreliable on POSIX. An
 * already-executable path (a user `amp` wrapper) runs as-is. */
function asAmpCommand(filePath: string): AmpCommand {
  return /\.(?:c|m)?js$/.test(filePath)
    ? { command: process.execPath, args: [filePath] }
    : { command: filePath, args: [] };
}

/** Resolves the same `@sourcegraph/amp` bundle the SDK's own `findAmpCommand()` uses, so history
 * reads and live turns land on the SAME binary (the lockstep invariant). Only the node_modules tier
 * is verified against the legacy SDK — its real `findAmpCommand()` is node_modules-only with no
 * env/PATH fallback; the `AMP_CLI_PATH`/`$AMP_HOME`/PATH tiers below are carried over from the neo
 * resolver as a best-effort net for odd installs, re-verify them if they ever matter. The runtime
 * probe is deliberately not consulted — `execute()` cannot be pointed at a probed path, so
 * preferring one would guarantee divergence. */
export function resolveAmpCli(): AmpCommand {
  const local = ampPackageBinary();
  if (local) return asAmpCommand(local);
  const binary = process.platform === 'win32' ? 'amp.exe' : 'amp';
  const fromEnv = env.AMP_CLI_PATH;
  if (fromEnv && existsSync(fromEnv)) return asAmpCommand(fromEnv);
  const ampHome = env.AMP_HOME ?? join(homedir(), '.amp');
  for (const candidate of [join(ampHome, 'sdk', 'bin', binary), join(ampHome, 'bin', binary)]) {
    if (existsSync(candidate)) return asAmpCommand(candidate);
  }
  // Last resort: let execFile resolve `amp` from PATH.
  return asAmpCommand(binary);
}

/** The `@sourcegraph/amp` package's bin — the legacy CLI carrier. It has no postinstall/hardlink
 * step: `bin.amp` points permanently at `dist/main.js`, a pure-JS bundle run via `node`. */
function ampPackageBinary(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('@sourcegraph/amp/package.json');
    const parsed: unknown = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    const bin = isRecord(parsed) && isRecord(parsed.bin) ? parsed.bin.amp : undefined;
    if (typeof bin !== 'string') return undefined;
    const binPath = join(dirname(pkgJsonPath), bin);
    return existsSync(binPath) ? binPath : undefined;
  } catch {
    return undefined;
  }
}

async function runAmpThreads(args: string[]): Promise<unknown> {
  const cli = resolveAmpCli();
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(cli.command, [...cli.args, 'threads', ...args], {
      timeout: 30000,
      // A long thread's export easily exceeds execFile's 1 MiB default.
      maxBuffer: 32 * 1024 * 1024,
    }));
  } catch (err) {
    const stderr =
      isRecord(err) && typeof err.stderr === 'string' && err.stderr.trim().length > 0
        ? `: ${err.stderr.trim()}`
        : '';
    throw new Error(`amp: 'threads ${args[0]}' failed${stderr}`, { cause: err });
  }
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new Error(`amp: 'threads ${args[0]}' returned unexpected non-JSON output`);
  }
}

/** `tree` on a list row is the thread's working directory as a `file://` URL. */
function cwdFromTree(row: Record<string, unknown>): string | undefined {
  const tree = stringField(row, 'tree');
  if (!tree) return undefined;
  try {
    return fileURLToPath(tree);
  } catch {
    return tree;
  }
}

function rowToSession(row: Record<string, unknown>): AgentHistorySession | undefined {
  const id = stringField(row, 'id');
  if (!id) return undefined;
  return {
    historyId: asHistoryId(id),
    kind: 'amp',
    title: stringField(row, 'title'),
    cwd: cwdFromTree(row),
    updatedAt: timestampMs(row.updated) ?? timestampMs(row.updatedAt),
    messageCount: numberField(row, 'messageCount'),
    metadata: compactRecord({
      source: 'amp-threads-cli',
      visibility: stringField(row, 'visibility'),
    }),
  };
}

export async function listAmpHistory(opts: {
  offset: number;
  limit: number;
  cwd?: string;
}): Promise<{ sessions: AgentHistorySession[]; cursor?: string }> {
  if (opts.cwd === undefined) {
    // No filter: page on the server with the +1 look-ahead trick.
    const parsed = await runAmpThreads([
      'list',
      '--json',
      '--limit',
      String(opts.limit + 1),
      '--offset',
      String(opts.offset),
    ]);
    const rows = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    const sessions = rows.slice(0, opts.limit).flatMap((row) => rowToSession(row) ?? []);
    return { sessions, cursor: cursorFromFetched(opts.offset, rows.length, opts.limit) };
  }
  // A cwd filter must apply before pagination and the server cannot filter by tree — fetch one
  // large page and page in memory. Threads beyond that window are not surfaced (bounded coverage).
  const parsed = await runAmpThreads(['list', '--json', '--limit', '500', '--offset', '0']);
  const rows = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  const matching = rows
    .flatMap((row) => rowToSession(row) ?? [])
    .filter((session) => session.cwd === opts.cwd);
  return {
    sessions: matching.slice(opts.offset, opts.offset + opts.limit),
    cursor: cursorFromTotal(opts.offset, matching.length, opts.limit),
  };
}

interface AmpToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
}

/** A user row's tool_result payloads must not replay (or preview) as something the user typed. */
function isToolResultBlock(block: unknown): block is AmpToolResultBlock {
  return (
    isRecord(block) &&
    block.type === 'tool_result' &&
    typeof block.tool_use_id === 'string' &&
    block.tool_use_id.length > 0
  );
}

function userTypedValue(message: Record<string, unknown>): unknown {
  const content = message.content;
  if (!Array.isArray(content)) return message;
  return content.filter((block) => !isToolResultBlock(block));
}

export async function readAmpHistory(
  historyId: AgentHistoryId,
): Promise<{ session: AgentHistorySession; events: AgentHistoryEvent[] }> {
  const parsed = await runAmpThreads(['export', historyId]);
  if (!isRecord(parsed)) throw new Error(`amp: history '${historyId}' was not found`);
  const messages = Array.isArray(parsed.messages) ? parsed.messages.filter(isRecord) : [];
  const firstUser = messages.find((message) => stringField(message, 'role') === 'user');
  const session: AgentHistorySession = {
    historyId,
    kind: 'amp',
    title: firstText(
      stringField(parsed, 'title'),
      firstUser ? previewText(textFromUnknown(userTypedValue(firstUser))) : undefined,
    ),
    cwd: cwdFromTree(parsed),
    // agentMode is the thread's mode — the axis this adapter surfaces as the model.
    model: stringField(parsed, 'agentMode'),
    createdAt: timestampMs(parsed.created),
    updatedAt: timestampMs(parsed.updatedAt),
    messageCount: messages.length,
    metadata: compactRecord({
      source: 'amp-threads-cli',
      visibility: stringField(parsed, 'visibility'),
      reasoningEffort: stringField(parsed, 'reasoningEffort'),
    }),
  };
  return { session, events: mapAmpHistoryEvents(historyId, messages) };
}

export function mapAmpHistoryEvents(
  historyId: AgentHistoryId,
  messages: Array<Record<string, unknown>>,
): AgentHistoryEvent[] {
  const events: AgentHistoryEvent[] = [];
  messages.forEach((message, index) => {
    const role = stringField(message, 'role');
    if (role !== 'user' && role !== 'assistant') return;
    const ts = timestampMs(message.created) ?? timestampMs(message.timestamp);
    const itemId =
      stringField(message, 'protocolMessageID') ??
      stringField(message, 'id') ??
      `${role}-${index.toString(36)}`;
    const value = role === 'user' ? userTypedValue(message) : message;
    const event = textHistoryEvent(historyId, role, itemId, value, ts);
    if (event) events.push(event);
  });
  return events;
}
