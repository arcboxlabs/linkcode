import type { StopReason, TokenUsage } from '@linkcode/schema';
import { isRecord } from '../../history-util';

/** Headless `--output-format streaming-json` line shapes verified on grok 0.2.102. */
export type GrokStreamEvent =
  | { type: 'text'; data: string }
  | { type: 'thought'; data: string }
  | {
      type: 'end';
      stopReason?: string;
      sessionId?: string;
      usage?: unknown;
      num_turns?: number;
      modelUsage?: unknown;
    }
  | { type: 'error'; message?: string }
  | { type: string; [key: string]: unknown };

export function parseGrokStreamLine(line: string): GrokStreamEvent | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  return value as GrokStreamEvent;
}

/** Map headless `end.stopReason` onto LinkCode stop reasons (verified: `EndTurn`). */
export function mapGrokStopReason(reason: string | undefined): StopReason {
  switch ((reason ?? '').toLowerCase()) {
    case 'cancelled':
    case 'canceled':
    case 'interrupt':
    case 'interrupted':
      return 'cancelled';
    case 'max_tokens':
    case 'maxtokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

/** Map headless spend fields (snake_case) onto TokenUsage. */
export function mapGrokUsage(usage: unknown): TokenUsage | undefined {
  if (!isRecord(usage)) return undefined;
  const input = readNonNegInt(usage.input_tokens);
  const output = readNonNegInt(usage.output_tokens);
  const cacheRead = readNonNegInt(usage.cache_read_input_tokens);
  if (input === undefined && output === undefined && cacheRead === undefined) return undefined;
  return {
    ...(input !== undefined && { inputTokens: input }),
    ...(output !== undefined && { outputTokens: output }),
    ...(cacheRead !== undefined && { cacheReadTokens: cacheRead }),
  };
}

const RE_AUTH_FAILURE = /not authenticated|unauthori[sz]ed|401|sign in|login required|auth/i;

export function isAuthFailureMessage(message: string): boolean {
  return RE_AUTH_FAILURE.test(message);
}

function readNonNegInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.trunc(value);
}
