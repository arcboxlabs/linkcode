import type { Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { env } from 'node:process';
import type { AgentHistoryEvent, AgentHistoryId, AgentHistorySession } from '@linkcode/schema';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { not } from 'foxts/guard';
import {
  asHistoryId,
  compactRecord,
  firstText,
  isRecord,
  previewText,
  recordField,
  stringField,
  textFromUnknown,
  textHistoryEvent,
  timestampMs,
} from '../../history-util';

/** Codex persists machine-injected context into the rollout as ordinary user-role messages,
 * recognizable only by their wrapper tag. They are not conversation and must not replay as user
 * bubbles (or become a session's title preview). A real user message could begin with `<` too,
 * so match the known tags exactly rather than anything XML-ish. */
const SYNTHETIC_USER_TAGS = ['<environment_context>', '<user_instructions>', '<turn_aborted>'];

export function isSyntheticCodexUserText(text: string): boolean {
  const trimmed = text.trimStart();
  return SYNTHETIC_USER_TAGS.some((tag) => trimmed.startsWith(tag));
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
        const text = textFromUnknown(payload);
        if (text.trim().length === 0) continue;
        if (role === 'user' && isSyntheticCodexUserText(text)) continue;
        messageCount += 1;
        if (role === 'user') firstUserText ??= previewText(text);
        else firstAssistantText ??= previewText(text);

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

export function mapCodexHistoryEvents(
  historyId: AgentHistoryId,
  rows: JsonRecord[],
): AgentHistoryEvent[] {
  const events: AgentHistoryEvent[] = [];
  rows.forEach((row, index) => {
    if (stringField(row, 'type') !== 'response_item') return;
    const payload = recordField(row, 'payload');
    if (!payload) return;
    const role = stringField(payload, 'role');
    if (role !== 'user' && role !== 'assistant') return;
    if (role === 'user' && isSyntheticCodexUserText(textFromUnknown(payload))) return;
    const itemId =
      stringField(payload, 'id') ?? stringField(row, 'id') ?? `${role}-${index.toString(36)}`;
    const event = textHistoryEvent(historyId, role, itemId, payload, timestampMs(row.timestamp));
    if (event) events.push(event);
  });
  return events;
}

function idFromFilename(path: string): string {
  const name = basename(path, '.jsonl');
  return name.length > 0 ? name : path;
}
