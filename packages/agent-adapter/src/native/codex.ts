import type {
  AgentHistoryCapabilities,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  ContentBlock,
  StartOptions,
  TokenUsage,
  ToolCallContent,
  ToolCallStatus,
} from '@linkcode/schema';
import type { ThreadEvent, ThreadItem, ThreadOptions, Usage } from '@openai/codex-sdk';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { invariant } from 'foxts/guard';
import { BaseAgentAdapter } from '../base';
import { asHistoryId, boundedLimit, cursorFromTotal, cursorOffset } from '../history-util';
import { contentToText } from '../util';
import {
  codexIndexEntryToSession,
  codexSummaryToSession,
  findCodexTranscript,
  mapCodexHistoryEvents,
  readCodexIndex,
  readCodexTranscriptSummaries,
  readJsonlFile,
} from './codex-history';

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
    invariant(this.thread, 'codex: session not started');
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
        this.emitError(extractErrorMessage(err) ?? 'Unknown error');
      }
    }
    // The turn stream ended (normally, by turn.failed/error, or by abort); finalize any dangling tool.
    this.teardown();
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
      case 'thread.started':
        // The rollout id this live thread persists under — the provider-local history id.
        this.emitSessionRef(asHistoryId(ev.thread_id));
        break;
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
        this.handleItem(ev.item);
        break;
      default:
        break;
    }
  }

  private handleItem(item: ThreadItem): void {
    switch (item.type) {
      case 'agent_message':
        this.streamDelta(item.id, item.text, 'message');
        break;
      case 'reasoning':
        this.streamDelta(item.id, item.text, 'thought');
        break;
      case 'command_execution':
        this.emitTool({
          toolCallId: item.id,
          title: item.command,
          kind: 'execute',
          status: mapCodexStatus(item.status),
          content: textContent(item.aggregated_output),
          rawInput: { command: item.command },
          rawOutput: item.exit_code,
        });
        break;
      case 'file_change':
        this.emitTool({
          toolCallId: item.id,
          title: 'Apply file changes',
          kind: 'edit',
          status: item.status === 'completed' ? 'completed' : 'failed',
          content: textContent(item.changes.map((c) => `${c.kind} ${c.path}`).join('\n')),
          locations: item.changes.map((c) => ({ path: c.path })),
        });
        break;
      case 'mcp_tool_call':
        this.emitTool({
          toolCallId: item.id,
          title: `${item.server}.${item.tool}`,
          kind: 'other',
          status: mapCodexStatus(item.status),
          content: [],
          rawInput: item.arguments,
          rawOutput: item.result ?? item.error,
        });
        break;
      case 'web_search':
        this.emitTool({
          toolCallId: item.id,
          title: item.query,
          kind: 'fetch',
          status: 'completed',
          content: [],
        });
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
}

function textContent(text: string): ToolCallContent[] {
  if (text.length === 0) return [];
  return [{ type: 'content', content: { type: 'text', text } }];
}
