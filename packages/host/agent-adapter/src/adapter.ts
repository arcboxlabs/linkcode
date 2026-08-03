import type {
  AgentCapabilities,
  AgentEvent,
  AgentHistoryBranchOptions,
  AgentHistoryCapabilities,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentInput,
  AgentKind,
  AgentStartCatalog,
  MessageId,
  StartOptions,
} from '@linkcode/schema';
import type { Unsubscribe } from '@linkcode/transport';

export type AgentStartCatalogOptions = Partial<Pick<StartOptions, 'cwd' | 'model' | 'config'>>;

export interface BrowserToolExecuteResult {
  ok: boolean;
  value?: unknown;
  logs: string[];
  error?: string;
}

export interface BrowserToolset {
  readonly documentation: string;
  execute(code: string): Promise<BrowserToolExecuteResult>;
}

export type BrowserToolsetFactory = () => BrowserToolset;

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
  attachBrowserTools?(createToolset: BrowserToolsetFactory): void;
  start(opts: StartOptions): Promise<void>;
  startCatalog(opts?: AgentStartCatalogOptions): Promise<AgentStartCatalog>;
  /** List provider-local historical sessions, if supported. */
  listHistory(opts?: AgentHistoryListOptions): Promise<AgentHistoryListResult>;
  /** Read a provider-local historical session as normalized events, if supported. */
  readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult>;
  /** Start/resume a live adapter session from a provider-local history id, if supported. */
  resumeHistory(opts: AgentHistoryResumeOptions, startOpts: StartOptions): Promise<void>;
  /** Start this adapter on a provider child branched before the cursor's historical prompt. */
  branchHistory?(opts: AgentHistoryBranchOptions, startOpts: StartOptions): Promise<void>;
  send(input: AgentInput): Promise<void>;
  /** Subscribe to events normalized by the abstraction layer. */
  onEvent(cb: (e: AgentEvent) => void): Unsubscribe;
  stop(): Promise<void>;
}

const BROWSER_RESULT_STRING_CAP = 4000;

export interface BrowserToolRendered {
  text: string;
  image?: { mimeType: string; base64: string };
}

export function renderBrowserToolResult(result: BrowserToolExecuteResult): BrowserToolRendered {
  const logs = result.logs.length > 0 ? `\nconsole:\n${result.logs.join('\n')}` : '';
  if (!result.ok) return { text: `Error: ${result.error ?? 'unknown error'}${logs}` };
  const image = detectImageValue(result.value);
  if (image) return { text: `[screenshot attached]${logs}`, image };
  const value =
    result.value === undefined
      ? 'undefined'
      : (JSON.stringify(result.value, capLongStrings, 2) ?? 'undefined');
  return { text: `${value}${logs}` };
}

function capLongStrings(_key: string, value: unknown): unknown {
  return typeof value === 'string' && value.length > BROWSER_RESULT_STRING_CAP
    ? `${value.slice(0, BROWSER_RESULT_STRING_CAP)}… [${value.length} chars total]`
    : value;
}

function detectImageValue(value: unknown): { mimeType: string; base64: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('mimeType' in value) || !('base64' in value)) return undefined;
  return typeof value.mimeType === 'string' &&
    value.mimeType.startsWith('image/') &&
    typeof value.base64 === 'string'
    ? { mimeType: value.mimeType, base64: value.base64 }
    : undefined;
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
