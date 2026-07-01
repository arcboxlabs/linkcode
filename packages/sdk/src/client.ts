import type { HistoryListClientOptions, HistoryReadClientOptions } from '@linkcode/client-core';
import { LinkCodeClient } from '@linkcode/client-core';
import type {
  AgentHistoryId,
  AgentHistoryListResult,
  AgentHistoryReadResult,
  AgentInput,
  AgentKind,
  PermissionOutcome,
  SessionId,
  SessionInfo,
  StartOptions,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';

export type RequestResult<T = unknown> = Promise<{
  data: T;
  request?: Request;
  response?: Response;
}>;

export type Options<TData extends object = object> = TData & {
  client?: LinkCodeSdkClient;
  meta?: Record<string, unknown>;
};

export interface LinkCodeSdkClientOptions {
  transport: Transport;
}

export class LinkCodeSdkClient {
  readonly raw: LinkCodeClient;

  constructor(options: LinkCodeSdkClientOptions) {
    this.raw = new LinkCodeClient(options.transport);
  }

  buildUrl(): string {
    return 'linkcode://transport';
  }

  getConfig(): Record<string, never> {
    return {};
  }

  setConfig(): void {
    // The transport-backed SDK is configured at construction time.
  }

  request(): Promise<never> {
    return Promise.reject(new Error('LinkCodeSdkClient does not expose raw HTTP requests'));
  }

  connect(): Promise<void> {
    return this.raw.connect();
  }

  dispose(): void {
    this.raw.dispose();
  }

  listSessions(): RequestResult<SessionInfo[]> {
    return toResult(this.raw.listSessions());
  }

  startSession(opts: StartOptions): RequestResult<SessionId> {
    return toResult(this.raw.startSession(opts));
  }

  stopSession(sessionId: SessionId): RequestResult<{ ok: true }> {
    return toResult(this.raw.stopSession(sessionId));
  }

  listHistory(
    agentKind: AgentKind,
    opts?: HistoryListClientOptions,
  ): RequestResult<AgentHistoryListResult> {
    return toResult(this.raw.listHistory(agentKind, opts));
  }

  readHistory(
    agentKind: AgentKind,
    opts: HistoryReadClientOptions,
  ): RequestResult<AgentHistoryReadResult> {
    return toResult(this.raw.readHistory(agentKind, opts));
  }

  resumeHistory(
    agentKind: AgentKind,
    historyId: AgentHistoryId,
    startOpts: StartOptions,
  ): RequestResult<SessionId> {
    return toResult(this.raw.resumeHistory(agentKind, historyId, startOpts));
  }

  sendInput(sessionId: SessionId, input: AgentInput): RequestResult<{ ok: true }> {
    return toResult(this.raw.send(sessionId, input));
  }

  promptText(sessionId: SessionId, text: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.promptText(sessionId, text));
  }

  cancel(sessionId: SessionId): RequestResult<{ ok: true }> {
    return toResult(this.raw.cancel(sessionId));
  }

  setModel(sessionId: SessionId, model: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.setModel(sessionId, model));
  }

  respondPermission(
    sessionId: SessionId,
    requestId: string,
    outcome: PermissionOutcome,
  ): RequestResult<{ ok: true }> {
    return toResult(this.raw.respondPermission(sessionId, requestId, outcome));
  }
}

let defaultClient: LinkCodeSdkClient | null = null;

export function createClient(options: LinkCodeSdkClientOptions): LinkCodeSdkClient {
  return new LinkCodeSdkClient(options);
}

export function setDefaultClient(client: LinkCodeSdkClient | null): void {
  defaultClient = client;
}

export function getDefaultClient(): LinkCodeSdkClient {
  if (!defaultClient) throw new Error('LinkCode SDK client has not been initialized');
  return defaultClient;
}

export function resolveClient(options?: { client?: LinkCodeSdkClient }): LinkCodeSdkClient {
  return options?.client ?? getDefaultClient();
}

function toResult<T>(value: Promise<T>): RequestResult<T> {
  return value.then((data) => ({ data }));
}
