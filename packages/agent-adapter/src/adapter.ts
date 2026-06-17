import type { AgentEvent, AgentInput, AgentKind, MessageId, StartOptions } from '@linkcode/schema';
import type { Unsubscribe } from '@linkcode/transport';

/**
 * AgentAdapter: the unified adapter interface for integrating each coding agent (PLAN §4.2 / §6).
 * One adapter per agent, hiding their differences from the upper layers; no per-SDK branching scattered
 * across the upper layers (PLAN §2.5). Implementations normalize their native events into the zod
 * `AgentEvent` contract (ACP-aligned), and accept the normalized `AgentInput`.
 */
export interface AgentAdapter {
  readonly kind: AgentKind;
  start(opts: StartOptions): Promise<void>;
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
