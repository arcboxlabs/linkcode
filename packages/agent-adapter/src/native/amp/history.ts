import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process, { env } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
  AgentHistoryEvent,
  AgentHistoryId,
  AgentHistorySession,
  ToolCall,
  ToolCallContent,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
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
import { ampToolKind, diffContentFromResult } from './tool';

const execFileAsync = promisify(execFile);

/**
 * Amp thread history lives on Sourcegraph's backend, not on disk (no local cache exists), and the
 * SDK wraps only `threads.new`/`threads.markdown`. Listing and structured reads exist solely as
 * CLI subcommands — `amp threads list --json` and `amp threads export <id>` — which are
 * UNDOCUMENTED in the public manual (verified live against @ampcode/cli 0.0.1783428245; the
 * lockfile pins a nearby build — re-verify the subcommands on every bump, they can be renamed
 * without notice). Every call here is an authenticated network round-trip; auth comes from the
 * CLI's own login state or an ambient `AMP_API_KEY` (history ops run without `StartOptions`, so
 * the per-session config key cannot reach them).
 *
 * The export's messages are Anthropic-shaped (`text`/`thinking`/`tool_use`/`tool_result` blocks),
 * verified live against @ampcode/cli 0.0.1783401425: a `tool_use` carries `id`/`name`/`input`; its
 * `tool_result` carries `toolUseID` (the SAME `TU-` id the live path keys on) and a `run.result`
 * payload — `{ diff, lineRange }` for file edits, `{ output, exitCode }` for shell — under
 * `run.status`. So replay reproduces the announce/settle tool-call pairs the live stream emits,
 * converging by id. Exports omit `parent_tool_use_id`, so nested subagent tools replay flat.
 */

/** Mirrors the SDK's own `findAmpCommand` order exactly — node_modules pair → `AMP_CLI_PATH` →
 * `$AMP_HOME/sdk/bin` → `$AMP_HOME/bin` → PATH — so history reads and live turns land on the SAME
 * binary (the lockstep invariant): a machine with both the pinned pair and a user install must not
 * read history through a version-drifted CLI whose undocumented `threads` output may differ. The
 * runtime probe is deliberately not consulted here for the same reason — `execute()` cannot be
 * pointed at a probed path, so preferring one would guarantee divergence. */
export function resolveAmpCli(): string {
  const local = ampPackageBinary();
  if (local) return local;
  const binary = process.platform === 'win32' ? 'amp.exe' : 'amp';
  const fromEnv = env.AMP_CLI_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const ampHome = env.AMP_HOME ?? join(homedir(), '.amp');
  for (const candidate of [join(ampHome, 'sdk', 'bin', binary), join(ampHome, 'bin', binary)]) {
    if (existsSync(candidate)) return candidate;
  }
  // Last resort: let execFile resolve `amp` from PATH, matching the SDK's own final fallback.
  return binary;
}

/** The `@ampcode/cli` package's bin — the SDK-pinned pair (its postinstall hardlinks the real
 * platform binary over the `bin/amp.exe` placeholder on every OS, so the path is executable). */
function ampPackageBinary(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('@ampcode/cli/package.json');
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
    ({ stdout } = await execFileAsync(cli, ['threads', ...args], {
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

interface AmpToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: unknown;
}

function isToolUseBlock(block: unknown): block is AmpToolUseBlock {
  return (
    isRecord(block) &&
    block.type === 'tool_use' &&
    typeof block.id === 'string' &&
    block.id.length > 0 &&
    typeof block.name === 'string' &&
    block.name.length > 0
  );
}

interface AmpToolResultBlock {
  type: 'tool_result';
  toolUseID: string;
  run?: unknown;
}

/** A user row's tool_result payloads must not replay (or preview) as something the user typed. */
function isToolResultBlock(block: unknown): block is AmpToolResultBlock {
  return (
    isRecord(block) &&
    block.type === 'tool_result' &&
    typeof block.toolUseID === 'string' &&
    block.toolUseID.length > 0
  );
}

function userTypedValue(message: Record<string, unknown>): unknown {
  const content = message.content;
  if (!Array.isArray(content)) return message;
  return content.filter((block) => !isToolResultBlock(block));
}

/** Only `done` is seen on live exports; treat an explicit error/aborted status as a failure and
 * default everything else to completed — a settled history tool almost always ran. */
const AMP_RESULT_ERROR_STATUSES = new Set(['error', 'failed', 'aborted', 'cancelled', 'canceled']);

function ampResultStatus(run: unknown): 'completed' | 'failed' {
  const status = isRecord(run) ? run.status : undefined;
  return typeof status === 'string' && AMP_RESULT_ERROR_STATUSES.has(status)
    ? 'failed'
    : 'completed';
}

/** Turn a `tool_result.run` into tool-call content: a file edit's `{ diff }` becomes a structured
 * diff card, a shell tool's `{ output }` becomes plain text, and any other shape salvages whatever
 * text it can. */
function ampResultContent(run: unknown): ToolCallContent[] {
  const result = isRecord(run) ? run.result : undefined;
  const diff = diffContentFromResult(result);
  if (diff) return diff;
  const text =
    isRecord(result) && typeof result.output === 'string'
      ? result.output
      : textFromUnknown(result ?? run);
  return text.trim().length > 0 ? [{ type: 'content', content: textBlock(text) }] : [];
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
  const mapper = createAmpHistoryEventMapper(historyId);
  return messages.flatMap((message, index) => mapper(message, index));
}

/**
 * Stateful per-read mapper: correlates each `tool_use` announce with the `tool_result` that later
 * settles it (linked by amp's `TU-` id — `tool_use.id` === `tool_result.toolUseID`, the SAME id the
 * live path keys on), replaying the announce/settle full-snapshot pairs the live stream emits so a
 * seeded timeline and live re-emits of the same call converge by id (`buildConversation` replaces
 * tool calls by id) instead of duplicating.
 */
function createAmpHistoryEventMapper(
  historyId: AgentHistoryId,
): (message: Record<string, unknown>, index: number) => AgentHistoryEvent[] {
  const announced = new Map<string, ToolCall>();

  const toolEvent = (toolCall: ToolCall): AgentHistoryEvent => {
    announced.set(toolCall.toolCallId, toolCall);
    return { historyId, itemId: toolCall.toolCallId, event: { type: 'tool-call', toolCall } };
  };

  return (message, index) => {
    const role = stringField(message, 'role');
    if (role !== 'user' && role !== 'assistant') return [];
    const events: AgentHistoryEvent[] = [];
    const ts = timestampMs(message.created) ?? timestampMs(message.timestamp);
    const itemId =
      stringField(message, 'protocolMessageID') ??
      stringField(message, 'id') ??
      `${role}-${index.toString(36)}`;
    const blocks = Array.isArray(message.content) ? message.content : [];

    if (role === 'assistant') {
      const text = textHistoryEvent(historyId, 'assistant', itemId, message, ts);
      if (text) events.push(text);
      for (const block of blocks) {
        if (!isToolUseBlock(block)) continue;
        events.push(
          toolEvent({
            toolCallId: block.id,
            title: block.name,
            kind: ampToolKind(block.name),
            status: 'in_progress',
            content: [],
            rawInput: block.input,
          }),
        );
      }
      return events;
    }

    for (const block of blocks) {
      if (!isToolResultBlock(block)) continue;
      const existing = announced.get(block.toolUseID);
      events.push(
        toolEvent({
          toolCallId: block.toolUseID,
          // The announce can sit beyond this read's page window; fall back to first-sight defaults.
          title: existing?.title ?? block.toolUseID,
          kind: existing?.kind ?? 'other',
          status: ampResultStatus(block.run),
          // Announce-time content is empty for amp (the diff arrives with the result); keep any
          // existing content ahead of it anyway to mirror claude's ordering.
          content: [...(existing?.content ?? []), ...ampResultContent(block.run)],
          rawInput: existing?.rawInput,
          rawOutput: block.run,
        }),
      );
    }
    // Tool-result rows are plumbing; only what remains after removing them is a real typed prompt.
    const text = textHistoryEvent(historyId, 'user', itemId, userTypedValue(message), ts);
    if (text) events.push(text);
    return events;
  };
}
