import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  Client,
  ReadTextFileRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
  WriteTextFileRequest,
} from '@agentclientprotocol/sdk';
import type {
  AgentEvent,
  AgentKind,
  ContentBlock,
  Plan,
  StartOptions,
  StopReason,
  ToolCall,
  ToolCallStatus,
  ToolKind,
} from '@linkcode/schema';
import { ContentBlockSchema, ToolCallUpdateSchema } from '@linkcode/schema';
import { BaseAgentAdapter } from '../base';

/** Describes how to launch an ACP-speaking agent as a subprocess. */
export interface AcpAgentSpec {
  kind: AgentKind;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Map an ACP StopReason to ours — the two enums are identical by design. */
export function mapAcpStop(reason: string): StopReason {
  switch (reason) {
    case 'max_tokens':
      return 'max_tokens';
    case 'max_turn_requests':
      return 'max_turn_requests';
    case 'refusal':
      return 'refusal';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'end_turn';
  }
}

/**
 * Generic ACP adapter — the "long tail" seam (PLAN: native-4 + ACP seam). Spawns any ACP-speaking agent
 * CLI as a subprocess and drives it via `@agentclientprotocol/sdk`'s `ClientSideConnection` over stdio.
 *
 * Because our zod contract mirrors ACP's vocabulary, the `session/update` → `AgentEvent` mapping is ~1:1;
 * the casts below are safe (zod re-validates and strips extra keys at the transport boundary). The client
 * side implements `fs` locally (the daemon has filesystem access) and bridges permission asks onto our
 * permission-request/response round-trip.
 */
export class AcpAdapter extends BaseAgentAdapter {
  readonly kind: AgentKind;

  private readonly spec: AcpAgentSpec;
  private child: ChildProcessWithoutNullStreams | null = null;
  private conn: ClientSideConnection | null = null;
  private sessionId: string | null = null;

  constructor(spec: AcpAgentSpec) {
    super();
    this.kind = spec.kind;
    this.spec = spec;
  }

  protected async onStart(opts: StartOptions): Promise<void> {
    const child = spawn(this.spec.command, this.spec.args ?? [], {
      cwd: opts.cwd,
      env: { ...process.env, ...this.spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const conn = new ClientSideConnection(() => this.buildClient(), stream);
    this.conn = conn;
    await conn.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    });
    const session = await conn.newSession({ cwd: opts.cwd, mcpServers: [] });
    this.sessionId = session.sessionId;
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    if (!this.conn || !this.sessionId) throw new Error('acp: session not started');
    this.emitStatus('running');
    const res = await this.conn.prompt({
      sessionId: this.sessionId,
      prompt: content,
    });
    this.emitStop(mapAcpStop(res.stopReason));
    this.emitStatus('idle');
  }

  protected override async onCancel(): Promise<void> {
    if (this.conn && this.sessionId) await this.conn.cancel({ sessionId: this.sessionId });
  }

  protected override onStop(): Promise<void> {
    this.child?.kill();
    return Promise.resolve();
  }

  private buildClient(): Client {
    return {
      sessionUpdate: (params: SessionNotification) => {
        if (params.sessionId === this.sessionId) {
          const event = acpUpdateToEvent(params.update);
          if (event) this.emit(event);
        }
        return Promise.resolve();
      },
      requestPermission: async (
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> => {
        const outcome = await this.requestPermission(
          ToolCallUpdateSchema.parse(params.toolCall),
          params.options,
        );
        return { outcome };
      },
      readTextFile: async (params: ReadTextFileRequest) => ({
        content: await readFile(params.path, 'utf8'),
      }),
      async writeTextFile(params: WriteTextFileRequest) {
        await mkdir(dirname(params.path), { recursive: true });
        await writeFile(params.path, params.content, 'utf8');
        return {};
      },
    };
  }
}

/** Pure mapping from an ACP session/update to our AgentEvent (exported for unit tests). */
export function acpUpdateToEvent(update: SessionUpdate): AgentEvent | null {
  const u = toRecord(update);
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return contentChunk('agent-message-chunk', u.content);
    case 'agent_thought_chunk':
      return contentChunk('agent-thought-chunk', u.content);
    case 'user_message_chunk':
      return contentChunk('user-message-chunk', u.content);
    case 'tool_call':
      return { type: 'tool-call', toolCall: toToolCall(u) };
    case 'tool_call_update':
      return { type: 'tool-call-update', update: ToolCallUpdateSchema.parse(u) };
    case 'plan':
      return { type: 'plan', plan: { entries: (u.entries ?? []) as Plan['entries'] } };
    case 'current_mode_update':
      return { type: 'current-mode-update', currentModeId: stringFromUnknown(u.currentModeId) };
    default:
      return null;
  }
}

function contentChunk(
  type: 'agent-message-chunk' | 'agent-thought-chunk' | 'user-message-chunk',
  content: unknown,
): AgentEvent | null {
  if (!content) return null;
  const parsed = ContentBlockSchema.safeParse(content);
  if (!parsed.success) return null;
  return { type, content: parsed.data };
}

function toToolCall(u: Record<string, unknown>): ToolCall {
  const toolCallId = stringFromUnknown(u.toolCallId);
  return {
    toolCallId,
    title: typeof u.title === 'string' ? u.title : toolCallId,
    kind: (u.kind as ToolKind) ?? 'other',
    status: (u.status as ToolCallStatus) ?? 'pending',
    content: (u.content as ToolCall['content']) ?? [],
    rawInput: u.rawInput,
    rawOutput: u.rawOutput,
  };
}

function toRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}
