import type { Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { env } from 'node:process';
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
import { not } from 'foxts/guard';
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
import { codexToolAnnounce, codexToolSettle } from './history-tools';

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
    if (data.codePointAt(index) !== 61) return false;
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
 * instead (all verbatim in the 0.144.1 binary). Match markers exactly — a real user message could
 * begin with `<` or `#` too. */
const SYNTHETIC_USER_MARKERS = [
  '<environment_context>',
  '<user_instructions>',
  '<turn_aborted>',
  '<apps_instructions>',
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
 * injected parts of a glued row back in. Rollouts without event_msg rows degrade to marker-only. */
export function isSyntheticCodexUserPayload(
  payload: JsonRecord,
  realPromptTexts?: ReadonlySet<string>,
): boolean {
  const content = payload.content;
  const parts = Array.isArray(content) ? content : [payload];
  const texts = parts.map((part) => textFromUnknown(part));
  const marked = texts.filter((text) => isSyntheticCodexUserText(text));
  if (marked.length === 0) return false;
  if (!realPromptTexts) return true;
  if (marked.every((text) => realPromptTexts.has(text))) return false;
  const hasImage = parts.some(
    (part) => isRecord(part) && stringField(part, 'type') === 'input_image',
  );
  if (!hasImage) return true;
  const echoedText = texts.filter((_text, index) => !isCodexImageMarker(parts, index)).join('');
  return !realPromptTexts.has(echoedText);
}

/** The texts codex echoed as `event_msg`/`user_message` rows — the real prompts of the rollout. */
export function collectCodexPromptTexts(rows: JsonRecord[]): Set<string> {
  const texts = new Set<string>();
  for (const row of rows) {
    if (stringField(row, 'type') !== 'event_msg') continue;
    const payload = recordField(row, 'payload');
    if (!payload || stringField(payload, 'type') !== 'user_message') continue;
    const message = stringField(payload, 'message');
    if (message) texts.add(message);
  }
  return texts;
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

export function codexHome(): string {
  return env.CODEX_HOME ?? join(homedir(), '.codex');
}

export async function readCodexIndex(): Promise<Map<string, CodexIndexEntry>> {
  const rows = await readJsonlFile(join(codexHome(), 'session_index.jsonl'));
  const index = new Map<string, CodexIndexEntry>();
  for (const row of rows) {
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

export async function readCodexTranscriptSummaries(
  index: Map<string, CodexIndexEntry>,
): Promise<CodexTranscriptSummary[]> {
  const roots = [join(codexHome(), 'sessions'), join(codexHome(), 'archived_sessions')];
  const fileSets = await Promise.all(roots.map((root) => collectJsonlFiles(root)));
  const files = fileSets.flat();
  const summaries = await Promise.all(files.map((file) => readCodexTranscriptSummary(file, index)));
  return summaries.filter(not(undefined));
}

export async function findCodexTranscript(
  historyId: AgentHistoryId,
): Promise<CodexTranscriptSummary | undefined> {
  const index = await readCodexIndex();
  const summaries = await readCodexTranscriptSummaries(index);
  const id = historyId;
  return summaries.find((summary) => summary.id === id || summary.path === id);
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
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) pendingDirs.push(collectJsonlFiles(path, depth - 1));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
  for (const nestedFiles of await Promise.all(pendingDirs)) appendArrayInPlace(files, nestedFiles);
  return files;
}

export async function readJsonlFile(path: string): Promise<JsonRecord[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const rows: JsonRecord[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) rows.push(parsed);
    } catch {
      // Ignore corrupt partial lines; Codex may be writing the active transcript.
    }
  }
  return rows;
}

async function readCodexTranscriptSummary(
  path: string,
  index: Map<string, CodexIndexEntry>,
): Promise<CodexTranscriptSummary | undefined> {
  const [rows, fileStat] = await Promise.all([readJsonlFile(path), statOrUndefined(path)]);
  if (rows.length === 0) return undefined;
  const promptTexts = collectCodexPromptTexts(rows);

  let id: string | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  let createdAt: number | undefined;
  let updatedAt: number | undefined;
  let firstUserText: string | undefined;
  let firstAssistantText: string | undefined;
  let messageCount = 0;
  let cliVersion: string | undefined;
  let originator: string | undefined;
  let threadSource: string | undefined;
  let modelProvider: string | undefined;
  let gitBranch: string | undefined;

  for (const row of rows) {
    const rowType = stringField(row, 'type');
    const rowTs = timestampMs(row.timestamp);
    if (rowTs !== undefined) {
      createdAt ??= rowTs;
      updatedAt = Math.max(updatedAt ?? 0, rowTs);
    }

    const payload = recordField(row, 'payload');
    if (!payload) continue;

    switch (rowType) {
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
        if (role !== 'user' && role !== 'assistant') continue;
        let text: string;
        if (role === 'user') {
          if (isSyntheticCodexUserPayload(payload, promptTexts)) continue;
          const content = codexUserContent(payload.content);
          if (content.length === 0) continue;
          text = content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
        } else {
          text = textFromUnknown(payload);
          if (text.trim().length === 0) continue;
        }
        messageCount += 1;
        if (role === 'user' && text.trim().length > 0) firstUserText ??= previewText(text);
        else if (role === 'assistant') firstAssistantText ??= previewText(text);

        break;
      }
      default:
        break;
    }
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

/**
 * Replays the rollout as the event stream the live turn emitted: text plus tool announce/settle
 * pairs correlated by `call_id`, mapped to the live presentation shapes by `history-tools.ts`.
 * History ids are NOT converged with the live app-server item ids (the rollout persists only
 * `call_id`; message rows carry no id) — the seed relies on the `uptoSeq` cut. Known lossiness
 * (CODE-97): reasoning stays unreplayable (`encrypted_content` only), and replayed edit diffs are
 * reconstructed from the `*** Begin Patch` envelope, not the app-server's richer live unified diff.
 */
export function mapCodexHistoryEvents(
  historyId: AgentHistoryId,
  rows: JsonRecord[],
): AgentHistoryEvent[] {
  const events: AgentHistoryEvent[] = [];
  const announced = new Map<string, ToolCall>();
  const promptTexts = collectCodexPromptTexts(rows);
  /** update_plan call_ids, so their `Plan updated` receipts don't settle a phantom tool row. */
  const planCalls = new Set<string>();

  // Records the snapshot as the call's latest state (settle reads it back as `existing`) AND
  // builds the history event — both announce and settle go through it, so the latest wins.
  const recordToolEvent = (toolCall: ToolCall): AgentHistoryEvent => {
    announced.set(toolCall.toolCallId, toolCall);
    return { historyId, itemId: toolCall.toolCallId, event: { type: 'tool-call', toolCall } };
  };

  rows.forEach((row, index) => {
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
    if (stringField(row, 'type') !== 'response_item') return;
    const payload = recordField(row, 'payload');
    if (!payload) return;

    const payloadType = stringField(payload, 'type');
    const callId = stringField(payload, 'call_id');
    if (payloadType !== undefined && callId !== undefined) {
      if (CODEX_TOOL_ANNOUNCE_TYPES.has(payloadType)) {
        const mapped = codexToolAnnounce(callId, payload);
        if ('plan' in mapped) {
          planCalls.add(callId);
          events.push({ historyId, itemId: callId, event: { type: 'plan', plan: mapped.plan } });
        } else {
          events.push(recordToolEvent(mapped.toolCall));
        }
        return;
      }
      if (CODEX_TOOL_OUTPUT_TYPES.has(payloadType)) {
        if (planCalls.has(callId)) return;
        events.push(recordToolEvent(codexToolSettle(callId, payload, announced.get(callId))));
        return;
      }
    }

    const role = stringField(payload, 'role');
    if (role !== 'user' && role !== 'assistant') return;
    if (role === 'user' && isSyntheticCodexUserPayload(payload, promptTexts)) return;
    const itemId =
      stringField(payload, 'id') ?? stringField(row, 'id') ?? `${role}-${index.toString(36)}`;
    const event =
      role === 'user'
        ? codexUserHistoryEvent(historyId, itemId, payload, timestampMs(row.timestamp))
        : textHistoryEvent(historyId, role, itemId, payload, timestampMs(row.timestamp));
    if (event) events.push(event);
  });
  return events;
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
