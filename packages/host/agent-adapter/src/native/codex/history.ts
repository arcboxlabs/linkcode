import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { env } from 'node:process';
import { createInterface } from 'node:readline';
import type {
  AgentHistoryEvent,
  AgentHistoryId,
  AgentHistorySession,
  ContentBlock,
  ToolCall,
} from '@linkcode/schema';
import {
  isSupportedAttachmentImageMimeType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  textBlock,
} from '@linkcode/schema';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { createFixedArray } from 'foxts/create-fixed-array';
import { not } from 'foxts/guard';
import { encodeHistoryBranchCursor } from '../../history-branch';
import {
  asHistoryId,
  asMessageId,
  compactRecord,
  firstText,
  isRecord,
  recordField,
  stringField,
  textFromUnknown,
  textHistoryEvent,
  timestampMs,
} from '../../history-util';
import {
  codexMcpEndFailed,
  codexMcpEndToolCall,
  codexToolAnnounce,
  codexToolSettle,
} from './history-tools';

const WHITESPACE_RUN_RE = /\s+/g;
const DATA_IMAGE_RE = /^data:([^;,]+);base64,(.*)$/;
const CODEX_IMAGE_OPEN_RE = /^<image name=\[Image #[1-9]\d*\] path="[^"\r\n]+">$/;
const MAX_ATTACHMENT_BASE64_LENGTH = 4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3);

function isBase64(data: string): boolean {
  if (data.length % 4 !== 0) return false;
  const payloadLength = data.endsWith('==')
    ? data.length - 2
    : data.endsWith('=')
      ? data.length - 1
      : data.length;
  for (let index = 0; index < payloadLength; index += 1) {
    const code = data.codePointAt(index) ?? -1;
    const isDigit = code >= 48 && code <= 57;
    const isUppercase = code >= 65 && code <= 90;
    const isLowercase = code >= 97 && code <= 122;
    if (!isDigit && !isUppercase && !isLowercase && code !== 43 && code !== 47) return false;
  }
  for (let index = payloadLength; index < data.length; index += 1) {
    if (data.charCodeAt(index) !== 61) return false;
  }
  return true;
}

function base64ByteLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

/** Codex persists machine-injected context as ordinary user-role messages recognizable only by
 * their leading marker; they must not replay as user bubbles or become a title preview. The XML
 * wrappers are the pre-0.14x shapes; codex 0.144 heads the AGENTS.md part with the prose markers
 * instead (all verbatim in the 0.144.1 binary). 0.144.6 injects each skill invocation's SKILL.md
 * as a `<skill>` row beside the typed `$name args` prompt, plus `<recommended_plugins>`;
 * `<codex_internal_context` keeps its attributes, so no closing `>`. Match markers exactly —
 * a real user message could begin with `<` or `#` too. */
const SYNTHETIC_USER_MARKERS = [
  '<environment_context>',
  '<user_instructions>',
  '<turn_aborted>',
  '<apps_instructions>',
  '<skill>',
  '<recommended_plugins>',
  '<codex_internal_context',
  '# AGENTS.md instructions',
  'These AGENTS.md instructions replace all previously provided AGENTS.md instructions.',
  'The previously provided AGENTS.md instructions no longer apply.',
];

export function isSyntheticCodexUserText(text: string): boolean {
  const trimmed = text.trimStart();
  return SYNTHETIC_USER_MARKERS.some((marker) => trimmed.startsWith(marker));
}

function isCodexImageMarker(parts: unknown[], index: number): boolean {
  const part = parts[index];
  if (!isRecord(part) || stringField(part, 'type') !== 'input_text') return false;
  const text = stringField(part, 'text');
  if (!text) return false;
  const previous = parts[index - 1];
  const next = parts[index + 1];
  const nextIsImage = isRecord(next) && stringField(next, 'type') === 'input_image';
  const previousIsImage = isRecord(previous) && stringField(previous, 'type') === 'input_image';
  return (
    (nextIsImage && CODEX_IMAGE_OPEN_RE.test(text)) || (previousIsImage && text === '</image>')
  );
}

/** codex 0.144 glues AGENTS.md and `<environment_context>` into ONE user row as separate content
 * parts, so the row is machine-injected when ANY part carries a marker — checking only the joined
 * text would miss every part after the first. Markers alone can false-positive on a pasted prompt,
 * so the row is rescued when every marker-bearing part is echoed as an `event_msg`/`user_message`
 * (real prompts always are, both TUI- and app-server-written; injected rows never are). Only the
 * marked parts count — an unmarked part that happens to equal a real prompt must not drag the
 * injected parts of a glued row back in. Rollouts without event_msg rows degrade to marker-only.
 * Echo comparison is by {@link promptTextFingerprint}, so scans never retain prompt bodies. */
export function isSyntheticCodexUserPayload(
  payload: JsonRecord,
  realPromptFingerprints?: ReadonlySet<string>,
): boolean {
  return isSyntheticCodexUserDigest(digestCodexUserPayload(payload), realPromptFingerprints);
}

/** Equality-only stand-in for a prompt text, so holding one per row stays a few dozen bytes even
 * when the text is a pasted file or an injected AGENTS.md blob. */
function promptTextFingerprint(text: string): string {
  return createHash('sha256').update(text, 'utf16le').digest('base64url');
}

/** The parts of a user row the synthetic judgment needs, small enough to hold for every user row
 * of a rollout while the surrounding rows stream by (the judgment needs the complete echoed-prompt
 * set, which is only known at end of file). */
interface CodexUserRowDigest {
  markedFingerprints: string[];
  hasImage: boolean;
  echoedFingerprint: string;
}

function digestCodexUserPayload(payload: JsonRecord): CodexUserRowDigest {
  const content = payload.content;
  const parts = Array.isArray(content) ? content : [payload];
  const texts = parts.map((part) => textFromUnknown(part));
  const hasImage = parts.some(
    (part) => isRecord(part) && stringField(part, 'type') === 'input_image',
  );
  return {
    markedFingerprints: texts.flatMap((text) =>
      isSyntheticCodexUserText(text) ? [promptTextFingerprint(text)] : [],
    ),
    hasImage,
    echoedFingerprint: hasImage
      ? promptTextFingerprint(
          texts.filter((_text, index) => !isCodexImageMarker(parts, index)).join(''),
        )
      : '',
  };
}

function isSyntheticCodexUserDigest(
  digest: CodexUserRowDigest,
  realPromptFingerprints?: ReadonlySet<string>,
): boolean {
  if (digest.markedFingerprints.length === 0) return false;
  if (!realPromptFingerprints) return true;
  if (digest.markedFingerprints.every((print) => realPromptFingerprints.has(print))) return false;
  if (!digest.hasImage) return true;
  return !realPromptFingerprints.has(digest.echoedFingerprint);
}

/** Fingerprints of the texts codex echoed as `event_msg`/`user_message` rows — the real prompts
 * of the rollout. */
export function collectCodexPromptFingerprints(rows: JsonRecord[]): Set<string> {
  const prints = new Set<string>();
  for (let i = 0, len = rows.length; i < len; i++) {
    const row = rows[i];
    if (stringField(row, 'type') !== 'event_msg') continue;
    const payload = recordField(row, 'payload');
    if (!payload || stringField(payload, 'type') !== 'user_message') continue;
    const message = stringField(payload, 'message');
    if (message) prints.add(promptTextFingerprint(message));
  }
  return prints;
}

/** Convert Codex's persisted response content without trusting an arbitrary URL or local path.
 * 0.144.1 stores both app-server data images and TUI local images as `input_image` data URLs; the
 * latter are surrounded by synthetic path-bearing text markers, which are presentation metadata
 * rather than user text. Remote/file URLs and malformed or oversized payloads stay adapter-local. */
function codexUserContent(value: unknown): ContentBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks: ContentBlock[] = [];
  let attachmentBytes = 0;
  value.forEach((part, index) => {
    if (!isRecord(part)) return;
    const type = stringField(part, 'type');
    if (type === 'input_text') {
      const text = stringField(part, 'text');
      if (!text) return;
      if (isCodexImageMarker(value, index)) return;
      blocks.push(textBlock(text));
      return;
    }
    if (type !== 'input_image') return;
    const url = stringField(part, 'image_url');
    const match = url ? DATA_IMAGE_RE.exec(url) : null;
    if (!match) return;
    const [, mimeType, data] = match;
    if (
      !isSupportedAttachmentImageMimeType(mimeType) ||
      data.length === 0 ||
      data.length > MAX_ATTACHMENT_BASE64_LENGTH ||
      !isBase64(data)
    ) {
      return;
    }
    const byteLength = base64ByteLength(data);
    if (
      byteLength > MAX_ATTACHMENT_BYTES ||
      attachmentBytes + byteLength > MAX_ATTACHMENT_TOTAL_BYTES
    ) {
      return;
    }
    attachmentBytes += byteLength;
    blocks.push({ type: 'image', data, mimeType });
  });
  return blocks;
}

function codexUserHistoryEvent(
  historyId: AgentHistoryId,
  itemId: string,
  payload: JsonRecord,
  ts?: AgentHistoryEvent['ts'],
): AgentHistoryEvent | undefined {
  const content = codexUserContent(payload.content);
  if (content.length === 0) return undefined;
  return {
    historyId,
    itemId,
    ts,
    event: { type: 'user-message', messageId: asMessageId(itemId), content },
  };
}

type JsonRecord = Record<string, unknown>;

interface CodexIndexEntry {
  id: string;
  title?: string;
  updatedAt?: number;
}

interface CodexTranscriptSummary {
  id: string;
  path?: string;
  title?: string;
  cwd?: string;
  model?: string;
  createdAt?: number;
  updatedAt?: number;
  messageCount?: number;
  metadata?: Record<string, unknown>;
}

interface DirectoryEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

export function codexHome(environment: NodeJS.ProcessEnv = env): string {
  return environment.CODEX_HOME ?? join(homedir(), '.codex');
}

export async function readCodexIndex(home = codexHome()): Promise<Map<string, CodexIndexEntry>> {
  const rows = await readJsonlFile(join(home, 'session_index.jsonl'));
  const index = new Map<string, CodexIndexEntry>();
  for (let i = 0, len = rows.length; i < len; i++) {
    const row = rows[i];
    const id = stringField(row, 'id');
    if (!id) continue;
    index.set(id, {
      id,
      title: firstText(stringField(row, 'thread_name'), stringField(row, 'title')),
      updatedAt: timestampMs(row.updated_at) ?? timestampMs(row.updatedAt),
    });
  }
  return index;
}

/** A rollout corpus can hold gigabytes; an unbounded fan-out once held enough of it in memory at
 * once to OOM the daemon (2026-08). Streams per file, a few files at a time. */
const SUMMARY_READ_CONCURRENCY = 8;

export async function readCodexTranscriptSummaries(
  index: Map<string, CodexIndexEntry>,
  home = codexHome(),
): Promise<CodexTranscriptSummary[]> {
  const files = await collectCodexRolloutFiles(home);
  const summaries: CodexTranscriptSummary[] = [];
  const workers = createFixedArray(Math.min(SUMMARY_READ_CONCURRENCY, files.length)).map(
    async () => {
      for (let file = files.pop(); file !== undefined; file = files.pop()) {
        // eslint-disable-next-line no-await-in-loop -- the loop is one bounded-concurrency worker.
        const summary = await readCodexTranscriptSummary(file, index);
        if (summary) summaries.push(summary);
      }
    },
  );
  await Promise.all(workers);
  return summaries;
}

export async function findCodexTranscript(
  historyId: AgentHistoryId,
  home = codexHome(),
): Promise<CodexTranscriptSummary | undefined> {
  const index = await readCodexIndex(home);
  const id: string = historyId;
  // Rollout filenames end with the thread id (`rollout-<ts>-<id>.jsonl`), so a suffix match reads
  // one file instead of the whole corpus; session_meta stays the identity check.
  const files = await collectCodexRolloutFiles(home);
  const candidates = files.filter((path) => {
    const name = basename(path, '.jsonl');
    return path === id || name === id || name.endsWith(`-${id}`);
  });
  const fastSummaries = await Promise.all(
    candidates.map((candidate) => readCodexTranscriptSummary(candidate, index)),
  );
  const fastHit = fastSummaries
    .filter(not(undefined))
    .find((summary) => summary.id === id || summary.path === id);
  if (fastHit) return fastHit;
  const summaries = await readCodexTranscriptSummaries(index, home);
  return summaries.find((summary) => summary.id === id || summary.path === id);
}

async function collectCodexRolloutFiles(home: string): Promise<string[]> {
  const roots = [join(home, 'sessions'), join(home, 'archived_sessions')];
  const fileSets = await Promise.all(roots.map((root) => collectJsonlFiles(root)));
  return fileSets.flat();
}

async function collectJsonlFiles(root: string, depth = 8): Promise<string[]> {
  if (depth < 0) return [];
  let entries: DirectoryEntry[];
  try {
    entries = await readdir(root, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  const files: string[] = [];
  const pendingDirs: Array<Promise<string[]>> = [];
  for (let i = 0, len = entries.length; i < len; i++) {
    const entry = entries[i];
    const path = join(root, entry.name);
    if (entry.isDirectory()) pendingDirs.push(collectJsonlFiles(path, depth - 1));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
  const nested = await Promise.all(pendingDirs);
  for (let i = 0, len = nested.length; i < len; i++) {
    const nestedFiles = nested[i];
    appendArrayInPlace(files, nestedFiles);
  }
  return files;
}

export async function readJsonlFile(path: string): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  await forEachJsonlRow(path, (row) => rows.push(row));
  return rows;
}

/** Stream one rollout's rows without ever holding the whole file — a single transcript can be
 * over 100MB, and whole-file reads were half of the 2026-08 daemon OOM. Returns the row count. */
async function forEachJsonlRow(path: string, onRow: (row: JsonRecord) => void): Promise<number> {
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  let count = 0;
  try {
    for await (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (isRecord(parsed)) {
          count += 1;
          onRow(parsed);
        }
      } catch {
        // Ignore corrupt partial lines; Codex may be writing the active transcript.
      }
    }
  } catch {
    // An unreadable or vanished file reads as empty, matching the old readFile fallback.
  } finally {
    lines.close();
  }
  return count;
}

/** A user row's summary contribution, deferred to end of stream: whether it counts (and previews)
 * depends on the complete echoed-prompt set. Holds previews and digests, never the row itself. */
interface PendingUserRow {
  digest: CodexUserRowDigest;
  empty: boolean;
  preview?: string;
}

async function readCodexTranscriptSummary(
  path: string,
  index: Map<string, CodexIndexEntry>,
): Promise<CodexTranscriptSummary | undefined> {
  const promptFingerprints = new Set<string>();
  const userRows: PendingUserRow[] = [];

  let id: string | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  let createdAt: number | undefined;
  let updatedAt: number | undefined;
  let firstAssistantText: string | undefined;
  let messageCount = 0;
  let cliVersion: string | undefined;
  let originator: string | undefined;
  let threadSource: string | undefined;
  let modelProvider: string | undefined;
  let gitBranch: string | undefined;

  const rowCount = await forEachJsonlRow(path, (row) => {
    const rowType = stringField(row, 'type');
    const rowTs = timestampMs(row.timestamp);
    if (rowTs !== undefined) {
      createdAt ??= rowTs;
      updatedAt = Math.max(updatedAt ?? 0, rowTs);
    }

    const payload = recordField(row, 'payload');
    if (!payload) return;

    switch (rowType) {
      case 'event_msg': {
        if (stringField(payload, 'type') !== 'user_message') break;
        const message = stringField(payload, 'message');
        if (message) promptFingerprints.add(promptTextFingerprint(message));
        break;
      }
      case 'session_meta': {
        id = stringField(payload, 'id') ?? id;
        cwd = stringField(payload, 'cwd') ?? cwd;
        model = stringField(payload, 'model') ?? model;
        originator = stringField(payload, 'originator') ?? originator;
        threadSource = stringField(payload, 'thread_source') ?? threadSource;
        cliVersion = stringField(payload, 'cli_version') ?? cliVersion;
        modelProvider = stringField(payload, 'model_provider') ?? modelProvider;
        const git = recordField(payload, 'git');
        if (git) gitBranch = stringField(git, 'branch') ?? gitBranch;
        createdAt = timestampMs(payload.timestamp) ?? createdAt;

        break;
      }
      case 'turn_context': {
        cwd = stringField(payload, 'cwd') ?? cwd;
        model = stringField(payload, 'model') ?? model;
        // payload.summary is the reasoning-summary mode ('auto'/'concise'/…), not a title.
        break;
      }
      case 'response_item': {
        const role = stringField(payload, 'role');
        if (role === 'user') {
          const content = codexUserContent(payload.content);
          const text = content
            .flatMap((block) => (block.type === 'text' ? [block.text] : []))
            .join('\n');
          userRows.push({
            digest: digestCodexUserPayload(payload),
            empty: content.length === 0,
            ...(text.trim().length > 0 && { preview: previewText(text) }),
          });
        } else if (role === 'assistant') {
          const text = textFromUnknown(payload);
          if (text.trim().length === 0) break;
          messageCount += 1;
          firstAssistantText ??= previewText(text);
        }
        break;
      }
      default:
        break;
    }
  });
  if (rowCount === 0) return undefined;
  const fileStat = await statOrUndefined(path);

  let firstUserText: string | undefined;
  for (let i = 0, len = userRows.length; i < len; i++) {
    const userRow = userRows[i];
    if (isSyntheticCodexUserDigest(userRow.digest, promptFingerprints) || userRow.empty) continue;
    messageCount += 1;
    if (userRow.preview !== undefined) firstUserText ??= userRow.preview;
  }

  id ??= idFromFilename(path);
  const indexEntry = index.get(id);
  return {
    id,
    path,
    title: firstText(indexEntry?.title, firstUserText, firstAssistantText),
    cwd,
    model,
    createdAt,
    updatedAt:
      indexEntry?.updatedAt ?? updatedAt ?? (fileStat ? Math.trunc(fileStat.mtimeMs) : undefined),
    messageCount,
    metadata: compactRecord({
      source: 'codex-local-jsonl',
      transcriptPath: path,
      fileSize: fileStat?.size,
      cliVersion,
      originator,
      threadSource,
      modelProvider,
      gitBranch,
    }),
  };
}

async function statOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch {
    // Transcript files can disappear while Codex is rotating or archiving sessions.
  }
}

export function codexSummaryToSession(summary: CodexTranscriptSummary): AgentHistorySession {
  return {
    historyId: asHistoryId(summary.id),
    kind: 'codex',
    title: summary.title,
    cwd: summary.cwd,
    model: summary.model,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    messageCount: summary.messageCount,
    metadata: summary.metadata,
  };
}

export function codexIndexEntryToSession(entry: CodexIndexEntry): AgentHistorySession {
  return {
    historyId: asHistoryId(entry.id),
    kind: 'codex',
    title: entry.title,
    updatedAt: entry.updatedAt,
    metadata: {
      source: 'codex-session-index',
      missingTranscript: true,
    },
  };
}

/** Rollout tool rows come in announce/settle pairs linked by `call_id`: `function_call` (JSON
 * `arguments`) and `custom_tool_call` (raw string `input`) announce; `*_output` rows settle.
 * `local_shell_call` is the older shell announce shape, kept for pre-0.140 transcripts. */
const CODEX_TOOL_ANNOUNCE_TYPES = new Set([
  'function_call',
  'custom_tool_call',
  'local_shell_call',
]);
const CODEX_TOOL_OUTPUT_TYPES = new Set([
  'function_call_output',
  'custom_tool_call_output',
  'local_shell_call_output',
]);

/** Response-backed calls use their output for content, while the MCP end row owns terminal status. */
function collectRespondedToolCallIds(rows: JsonRecord[]): {
  callIds: Set<string>;
  outputCallIds: Set<string>;
} {
  const callIds = new Set<string>();
  const outputCallIds = new Set<string>();
  for (let i = 0, len = rows.length; i < len; i++) {
    const row = rows[i];
    if (stringField(row, 'type') !== 'response_item') continue;
    const payload = recordField(row, 'payload');
    if (!payload) continue;
    const payloadType = stringField(payload, 'type');
    if (payloadType === undefined) continue;
    const isOutput = CODEX_TOOL_OUTPUT_TYPES.has(payloadType);
    if (!isOutput && !CODEX_TOOL_ANNOUNCE_TYPES.has(payloadType)) continue;
    const callId = stringField(payload, 'call_id');
    if (!callId) continue;
    callIds.add(callId);
    if (isOutput) outputCallIds.add(callId);
  }
  return { callIds, outputCallIds };
}

interface McpEndState {
  status: 'completed' | 'failed';
  rawOutput?: ToolCall['rawOutput'];
}

/** Precomputed so a response output that precedes its MCP end row still gets the structured verdict. */
function collectMcpEndStates(rows: JsonRecord[]): Map<string, McpEndState> {
  const states = new Map<string, McpEndState>();
  for (let i = 0, len = rows.length; i < len; i++) {
    const row = rows[i];
    if (stringField(row, 'type') !== 'event_msg') continue;
    const payload = recordField(row, 'payload');
    if (!payload || stringField(payload, 'type') !== 'mcp_tool_call_end') continue;
    const callId = stringField(payload, 'call_id');
    if (!callId) continue;
    const endToolCall = codexMcpEndToolCall(payload);
    states.set(callId, {
      status: codexMcpEndFailed(payload) ? 'failed' : 'completed',
      ...(endToolCall?.rawOutput !== undefined && { rawOutput: endToolCall.rawOutput }),
    });
  }
  return states;
}

/** Replays the rollout into live presentation shapes. MCP end-only calls retain their live
 * `call_id`; message and other response rows rely on the `uptoSeq` cut because their ids diverge. */
export function mapCodexHistoryEvents(
  historyId: AgentHistoryId,
  rows: JsonRecord[],
): AgentHistoryEvent[] {
  const events: AgentHistoryEvent[] = [];
  const announced = new Map<string, ToolCall>();
  const persistedMcpIdentities = collectCodexMcpIdentities(rows);
  const promptFingerprints = collectCodexPromptFingerprints(rows);
  const { callIds: respondedCallIds, outputCallIds: responseOutputCallIds } =
    collectRespondedToolCallIds(rows);
  const mcpEndStates = collectMcpEndStates(rows);
  const seenMcpEndCallIds = new Set<string>();
  /** update_plan call_ids, so their `Plan updated` receipts don't settle a phantom tool row. */
  const planCalls = new Set<string>();
  let currentTurnId: string | null = null;
  let previousTurnId: string | null = null;
  let userPromptCount = 0;

  // Records the snapshot as the call's latest state (settle reads it back as `existing`) AND
  // builds the history event — both announce and settle go through it, so the latest wins.
  const recordToolEvent = (toolCall: ToolCall): AgentHistoryEvent => {
    announced.set(toolCall.toolCallId, toolCall);
    return { historyId, itemId: toolCall.toolCallId, event: { type: 'tool-call', toolCall } };
  };

  rows.forEach((row, index) => {
    if (stringField(row, 'type') === 'turn_context') {
      const payload = recordField(row, 'payload');
      const turnId = payload ? stringField(payload, 'turn_id') : undefined;
      if (turnId && turnId !== currentTurnId) {
        previousTurnId = currentTurnId;
        currentTurnId = turnId;
      }
      return;
    }
    // A `compacted` row is the persisted compaction boundary; `message` carries the swapped-in
    // summary. `window_id` is optional on the wire format — fall back to a positional id.
    if (stringField(row, 'type') === 'compacted') {
      const payload = recordField(row, 'payload');
      const summary = payload ? stringField(payload, 'message') : undefined;
      const compactionId =
        (payload ? stringField(payload, 'window_id') : undefined) ??
        `compacted-${index.toString(36)}`;
      events.push({
        historyId,
        itemId: compactionId,
        ts: timestampMs(row.timestamp),
        event: { type: 'compaction', compactionId, ...(summary && { summary }) },
      });
      return;
    }
    if (stringField(row, 'type') === 'event_msg') {
      const payload = recordField(row, 'payload');
      if (payload && stringField(payload, 'type') === 'mcp_tool_call_end') {
        const callId = stringField(payload, 'call_id');
        if (callId === undefined) return;
        seenMcpEndCallIds.add(callId);
        if (respondedCallIds.has(callId)) {
          if (!responseOutputCallIds.has(callId)) {
            const existing = announced.get(callId);
            const endState = mcpEndStates.get(callId);
            if (existing && endState) events.push(recordToolEvent({ ...existing, ...endState }));
          }
          return;
        }
        const toolCall = codexMcpEndToolCall(payload);
        if (toolCall) events.push(recordToolEvent(toolCall));
      }
      return;
    }
    if (stringField(row, 'type') !== 'response_item') return;
    const payload = recordField(row, 'payload');
    if (!payload) return;

    const payloadType = stringField(payload, 'type');
    const callId = stringField(payload, 'call_id');
    if (payloadType !== undefined && callId !== undefined) {
      if (CODEX_TOOL_ANNOUNCE_TYPES.has(payloadType)) {
        const mapped = codexToolAnnounce(callId, payload, persistedMcpIdentities.get(callId));
        if ('plan' in mapped) {
          planCalls.add(callId);
          events.push({ historyId, itemId: callId, event: { type: 'plan', plan: mapped.plan } });
        } else {
          const endState =
            !responseOutputCallIds.has(callId) && seenMcpEndCallIds.has(callId)
              ? mcpEndStates.get(callId)
              : undefined;
          events.push(
            recordToolEvent(endState ? { ...mapped.toolCall, ...endState } : mapped.toolCall),
          );
        }
        return;
      }
      if (CODEX_TOOL_OUTPUT_TYPES.has(payloadType)) {
        if (planCalls.has(callId)) return;
        const settled = codexToolSettle(callId, payload, announced.get(callId));
        const status = mcpEndStates.get(callId)?.status;
        events.push(recordToolEvent(status ? { ...settled, status } : settled));
        return;
      }
    }

    const role = stringField(payload, 'role');
    if (role !== 'user' && role !== 'assistant') return;
    if (role === 'user' && isSyntheticCodexUserPayload(payload, promptFingerprints)) return;
    const itemId =
      stringField(payload, 'id') ?? stringField(row, 'id') ?? `${role}-${index.toString(36)}`;
    const event =
      role === 'user'
        ? codexUserHistoryEvent(historyId, itemId, payload, timestampMs(row.timestamp))
        : textHistoryEvent(historyId, role, itemId, payload, timestampMs(row.timestamp));
    if (event) {
      if (event.event.type === 'user-message') {
        if (userPromptCount === 0 || previousTurnId !== null) {
          event.event.branchCursor = encodeHistoryBranchCursor('codex', historyId, previousTurnId);
        }
        userPromptCount += 1;
      }
      events.push(event);
    }
  });
  return events;
}

function collectCodexMcpIdentities(
  rows: JsonRecord[],
): Map<string, { server: string; tool: string }> {
  const identities = new Map<string, { server: string; tool: string }>();
  for (let i = 0, len = rows.length; i < len; i++) {
    const row = rows[i];
    if (stringField(row, 'type') !== 'event_msg') continue;
    const payload = recordField(row, 'payload');
    if (!payload) continue;
    if (stringField(payload, 'type') === 'item_completed') {
      const item = recordField(payload, 'item');
      if (!item || stringField(item, 'type') !== 'McpToolCall') continue;
      const callId = stringField(item, 'id');
      const server = stringField(item, 'server');
      const tool = stringField(item, 'tool');
      if (callId && server && tool) identities.set(callId, { server, tool });
      continue;
    }
    if (stringField(payload, 'type') !== 'mcp_tool_call_end') continue;
    const callId = stringField(payload, 'call_id');
    const invocation = recordField(payload, 'invocation');
    const server = invocation ? stringField(invocation, 'server') : undefined;
    const tool = invocation ? stringField(invocation, 'tool') : undefined;
    if (callId && server && tool && !identities.has(callId)) {
      identities.set(callId, { server, tool });
    }
  }
  return identities;
}

function idFromFilename(path: string): string {
  const name = basename(path, '.jsonl');
  return name.length > 0 ? name : path;
}

function previewText(text: string): string {
  const flat = text.replaceAll(WHITESPACE_RUN_RE, ' ').trim();
  if (flat.length <= 120) return flat;
  return `${flat.slice(0, 117)}...`;
}
