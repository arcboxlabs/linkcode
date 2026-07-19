import type {
  AgentCapabilities,
  AgentEvent,
  AgentHistoryCapabilities,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentInput,
  AgentKind,
  MessageId,
  StartOptions,
} from '@linkcode/schema';
import type { Unsubscribe } from '@linkcode/transport';

/**
 * Unified adapter interface, one per coding agent (docs/ARCHITECTURE.md#key-contracts): no per-SDK
 * branching in upper layers (docs/ARCHITECTURE.md#core-principles). Implementations normalize
 * native events into the zod `AgentEvent` contract (ACP-aligned) and accept `AgentInput`.
 */
export interface AgentAdapter {
  readonly kind: AgentKind;
  /** Stable input features this adapter accepts, also advertised on the event stream at start. */
  readonly capabilities: AgentCapabilities;
  /** History support advertised by this adapter. Unsupported operations must reject clearly. */
  readonly historyCapabilities: AgentHistoryCapabilities;
  start(opts: StartOptions): Promise<void>;
  /** List provider-local historical sessions, if supported. */
  listHistory(opts?: AgentHistoryListOptions): Promise<AgentHistoryListResult>;
  /** Read a provider-local historical session as normalized events, if supported. */
  readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult>;
  /** Start/resume a live adapter session from a provider-local history id, if supported. */
  resumeHistory(opts: AgentHistoryResumeOptions, startOpts: StartOptions): Promise<void>;
  send(input: AgentInput): Promise<void>;
  /** Subscribe to events normalized by the abstraction layer. */
  onEvent(cb: (e: AgentEvent) => void): Unsubscribe;
  stop(): Promise<void>;
}

let __seq = 0;
function nextId(prefix: string): string {
  __seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${__seq.toString(36)}`;
}

/** Generate a normalized message id. */
export function nextMessageId(): MessageId {
  return nextId('msg') as MessageId;
}

/** Generate a tool-call id (used when the SDK doesn't supply one). */
export function nextToolCallId(): string {
  return nextId('tool');
}

/** Generate a correlation id for an agent→client request (permission / fs / terminal). */
export function nextRequestId(): string {
  return nextId('req');
}

/**
 * `AgentEvent` error `code` for a failed-authentication turn (signed out / expired token); the
 * daemon keys its login re-probe on it.
 */
export const AUTH_FAILED_ERROR_CODE = 'authentication_failed';
