import { readdir, readFile, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { env } from 'node:process';
import type {
  AgentHistoryCapabilities,
  AgentHistoryEvent,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentHistorySession,
  ContentBlock,
  MessageId,
  StartOptions,
  TokenUsage,
  ToolCall,
  ToolCallContent,
  ToolCallStatus,
} from '@linkcode/schema';
import type { ThreadEvent, ThreadItem, ThreadOptions, Usage } from '@openai/codex-sdk';
import { BaseAgentAdapter } from '../base';
import {
  asHistoryId,
  boundedLimit,
  compactRecord,
  cursorFromTotal,
  cursorOffset,
  firstText,
  isRecord,
  recordField,
  stringField,
  textFromUnknown,
  textHistoryEvent,
  timestampMs,
} from '../history-util';
import { contentToText } from '../util';

type CodexModule = typeof import('@openai/codex-sdk');
type CodexInstance = InstanceType<CodexModule['Codex']>;
type CodexThread = ReturnType<CodexInstance['startThread']>;

/** Map a Codex command/MCP status to our ToolCallStatus. */
export function mapCodexStatus(status: 'in_progress' | 'completed' | 'failed'): ToolCallStatus {
  return status;
}

/** Map Codex turn usage to our TokenUsage. */
export function mapCodexUsage(usage: Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cached_input_tokens,
  };
}

/**
 * Codex adapter — drives `@openai/codex-sdk` (`new Codex().startThread().runStreamed()`).
 * The SDK exposes no interactive permission callback; approvals are governed by `approvalPolicy` /
 * `sandboxMode` (runs autonomously by default). Cancellation is via an AbortSignal on the turn.
 */
export class CodexAdapter extends BaseAgentAdapter {
  readonly kind = 'codex' as const;
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: true,
    read: true,
    resume: true,
  };

  private codex: CodexInstance | null = null;
  private thread: CodexThread | null = null;
  private abort: AbortController | null = null;
  private resumeThreadId: string | undefined;
  /** Per-item cursor for turning Codex's cumulative text into deltas. */
  private readonly textLen = new Map<string, number>();

  protected async onStart(opts: StartOptions): Promise<void> {
    const codex = await this.createCodex();
    const threadOptions = this.threadOptions(opts);
    this.thread = this.resumeThreadId
      ? codex.resumeThread(this.resumeThreadId, threadOptions)
      : codex.startThread(threadOptions);
  }

  override async resumeHistory(
    opts: AgentHistoryResumeOptions,
    startOpts: StartOptions,
  ): Promise<void> {
    this.resumeThreadId = opts.historyId;
    try {
      await this.start(startOpts);
    } finally {
      this.resumeThreadId = undefined;
    }
  }

  override async listHistory(opts?: AgentHistoryListOptions): Promise<AgentHistoryListResult> {
    const offset = cursorOffset(opts?.cursor);
    const limit = boundedLimit(opts?.limit, 50, 200);
    const index = await readCodexIndex();
    const summaries = await readCodexTranscriptSummaries(index);
    const knownIds = new Set(summaries.map((summary) => summary.id));
    const indexOnly = [...index.values()].filter((entry) => !knownIds.has(entry.id));
    const sessions = [
      ...summaries.map(codexSummaryToSession),
      ...indexOnly.map(codexIndexEntryToSession),
    ]
      .filter((session) => !opts?.cwd || session.cwd === opts.cwd)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

    return {
      sessions: sessions.slice(offset, offset + limit),
      cursor: cursorFromTotal(offset, sessions.length, limit),
    };
  }

  override async readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    const offset = cursorOffset(opts.cursor);
    const limit = boundedLimit(opts.limit, 1000, 1000);
    const summary = await findCodexTranscript(opts.historyId);
    if (!summary?.path) throw new Error(`codex: history '${opts.historyId}' was not found`);
    const rows = await readJsonlFile(summary.path);
    const events = mapCodexHistoryEvents(opts.historyId, rows);
    return {
      session: codexSummaryToSession(summary),
      events: events.slice(offset, offset + limit),
      cursor: cursorFromTotal(offset, events.length, limit),
    };
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    if (!this.thread) throw new Error('codex: session not started');
    const abort = new AbortController();
    this.abort = abort;
    this.emitStatus('running');
    const { events } = await this.thread.runStreamed(contentToText(content), {
      signal: abort.signal,
    });
    try {
      for await (const ev of events) this.handleEvent(ev);
    } catch (err) {
      if (!abort.signal.aborted) {
        this.emitError(err instanceof Error ? err.message : String(err));
      }
    }
    this.emitStatus('idle');
  }

  protected override onCancel(): Promise<void> {
    this.abort?.abort();
    return Promise.resolve();
  }

  private configString(key: string): string | undefined {
    const value = this.opts?.config?.[key];
    return typeof value === 'string' ? value : undefined;
  }

  private async createCodex(): Promise<CodexInstance> {
    const mod = await this.loadSdk('@openai/codex-sdk', () => import('@openai/codex-sdk'));
    const apiKey = this.configString('apiKey');
    this.codex = new mod.Codex(apiKey ? { apiKey } : undefined);
    return this.codex;
  }

  private threadOptions(opts: StartOptions): ThreadOptions {
    return {
      workingDirectory: opts.cwd,
      model: opts.model,
      additionalDirectories: opts.additionalDirectories,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      skipGitRepoCheck: true,
    };
  }

  private handleEvent(ev: ThreadEvent): void {
    switch (ev.type) {
      case 'turn.started':
        this.emitStatus('running');
        break;
      case 'turn.completed':
        this.emitUsage(mapCodexUsage(ev.usage));
        this.emitStop('end_turn');
        break;
      case 'turn.failed':
        this.emitError(ev.error.message, undefined, true);
        break;
      case 'error':
        this.emitError(ev.message, undefined, false);
        break;
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        this.handleItem(ev.item, ev.type === 'item.completed');
        break;
      default:
        break;
    }
  }

  private handleItem(item: ThreadItem, completed: boolean): void {
    switch (item.type) {
      case 'agent_message':
        this.streamText(item.id, item.text, 'message');
        break;
      case 'reasoning':
        this.streamText(item.id, item.text, 'thought');
        break;
      case 'command_execution':
        this.emitTool(
          {
            toolCallId: item.id,
            title: item.command,
            kind: 'execute',
            status: mapCodexStatus(item.status),
            content: textContent(item.aggregated_output),
            rawInput: { command: item.command },
            rawOutput: item.exit_code,
          },
          completed,
        );
        break;
      case 'file_change':
        this.emitTool(
          {
            toolCallId: item.id,
            title: 'Apply file changes',
            kind: 'edit',
            status: item.status === 'completed' ? 'completed' : 'failed',
            content: textContent(item.changes.map((c) => `${c.kind} ${c.path}`).join('\n')),
          },
          completed,
        );
        break;
      case 'mcp_tool_call':
        this.emitTool(
          {
            toolCallId: item.id,
            title: `${item.server}.${item.tool}`,
            kind: 'other',
            status: mapCodexStatus(item.status),
            content: [],
            rawInput: item.arguments,
            rawOutput: item.result ?? item.error,
          },
          completed,
        );
        break;
      case 'web_search':
        this.emitTool(
          {
            toolCallId: item.id,
            title: item.query,
            kind: 'fetch',
            status: 'completed',
            content: [],
          },
          completed,
        );
        break;
      case 'todo_list':
        this.emit({
          type: 'plan',
          plan: {
            entries: item.items.map((t) => ({
              content: t.text,
              priority: 'medium' as const,
              status: t.completed ? ('completed' as const) : ('pending' as const),
            })),
          },
        });
        break;
      case 'error':
        this.emitError(item.message);
        break;
      default:
        break;
    }
  }

  /** Emit the full ToolCall on first sight, then ToolCallUpdate as it progresses. */
  private emitTool(toolCall: ToolCall, completed: boolean): void {
    if (completed) this.emit({ type: 'tool-call-update', update: toolCall });
    else this.emit({ type: 'tool-call', toolCall });
  }

  /** Convert Codex's cumulative item text into an incremental chunk. */
  private streamText(itemId: string, fullText: string, kind: 'message' | 'thought'): void {
    const prev = this.textLen.get(itemId) ?? 0;
    if (fullText.length <= prev) return;
    const delta = fullText.slice(prev);
    this.textLen.set(itemId, fullText.length);
    if (kind === 'message') this.emitAssistantText(delta, itemId as MessageId);
    else this.emitThought(delta, itemId as MessageId);
  }
}

function textContent(text: string): ToolCallContent[] {
  if (text.length === 0) return [];
  return [{ type: 'content', content: { type: 'text', text } }];
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

function codexHome(): string {
  return env.CODEX_HOME ?? join(homedir(), '.codex');
}

async function readCodexIndex(): Promise<Map<string, CodexIndexEntry>> {
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

async function readCodexTranscriptSummaries(
  index: Map<string, CodexIndexEntry>,
): Promise<CodexTranscriptSummary[]> {
  const roots = [join(codexHome(), 'sessions'), join(codexHome(), 'archived_sessions')];
  const fileSets = await Promise.all(roots.map((root) => collectJsonlFiles(root)));
  const files = fileSets.flat();
  const summaries = await Promise.all(files.map((file) => readCodexTranscriptSummary(file, index)));
  return summaries.filter((summary): summary is CodexTranscriptSummary => summary !== undefined);
}

async function findCodexTranscript(
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
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await collectJsonlFiles(path, depth - 1)));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
  return files;
}

async function readJsonlFile(path: string): Promise<JsonRecord[]> {
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
  let title: string | undefined;
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
        title = stringField(payload, 'summary') ?? title;

        break;
      }
      case 'response_item': {
        const role = stringField(payload, 'role');
        if (role !== 'user' && role !== 'assistant') continue;
        const text = textFromUnknown(payload);
        if (text.trim().length === 0) continue;
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
    title: firstText(indexEntry?.title, title, firstUserText, firstAssistantText),
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

function codexSummaryToSession(summary: CodexTranscriptSummary): AgentHistorySession {
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

function codexIndexEntryToSession(entry: CodexIndexEntry): AgentHistorySession {
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

function mapCodexHistoryEvents(historyId: AgentHistoryId, rows: JsonRecord[]): AgentHistoryEvent[] {
  const events: AgentHistoryEvent[] = [];
  rows.forEach((row, index) => {
    if (stringField(row, 'type') !== 'response_item') return;
    const payload = recordField(row, 'payload');
    if (!payload) return;
    const role = stringField(payload, 'role');
    if (role !== 'user' && role !== 'assistant') return;
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

function previewText(text: string): string {
  const flat = text.replaceAll(/\s+/g, ' ').trim();
  if (flat.length <= 120) return flat;
  return `${flat.slice(0, 117)}...`;
}
