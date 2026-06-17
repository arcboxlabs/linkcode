import type {
  ContentBlock,
  MessageId,
  StartOptions,
  TokenUsage,
  ToolCall,
  ToolCallContent,
  ToolCallStatus,
} from '@linkcode/schema';
import type { ThreadEvent, ThreadItem, Usage } from '@openai/codex-sdk';
import { BaseAgentAdapter } from '../base';
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

  private codex: CodexInstance | null = null;
  private thread: CodexThread | null = null;
  private abort: AbortController | null = null;
  /** Per-item cursor for turning Codex's cumulative text into deltas. */
  private readonly textLen = new Map<string, number>();

  protected async onStart(opts: StartOptions): Promise<void> {
    const mod = await this.loadSdk('@openai/codex-sdk', () => import('@openai/codex-sdk'));
    const apiKey = this.configString('apiKey');
    this.codex = new mod.Codex(apiKey ? { apiKey } : undefined);
    this.thread = this.codex.startThread({
      workingDirectory: opts.cwd,
      model: opts.model,
      additionalDirectories: opts.additionalDirectories,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      skipGitRepoCheck: true,
    });
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
