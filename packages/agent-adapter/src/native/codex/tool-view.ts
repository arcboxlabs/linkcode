import type {
  PlanEntry,
  ToolCall,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
} from '@linkcode/schema';
import { isRecord, stringField } from '../../history-util';

/**
 * The presentation shapes codex tool activity renders with — the single source for BOTH the live
 * adapter (`adapter.ts` item handling) and the history replay (`history-tools.ts`). A live turn
 * and its rollout replay must render identically; building both sides from these constructors
 * enforces that by construction instead of by convention.
 */

export function textContent(text: string): ToolCallContent[] {
  if (text.length === 0) return [];
  return [{ type: 'content', content: { type: 'text', text } }];
}

/** A `commandExecution` snapshot: the command line is the title, the aggregated output (settled
 * runs) is the content, and the exit code travels as `rawOutput`. */
export function execToolCall(opts: {
  toolCallId: string;
  command: string | undefined;
  cwd: string | undefined;
  status: ToolCallStatus;
  output?: string;
  rawOutput?: unknown;
}): ToolCall {
  return {
    toolCallId: opts.toolCallId,
    title: opts.command ?? 'command',
    kind: 'execute',
    status: opts.status,
    content: textContent(opts.output ?? ''),
    rawInput: { command: opts.command, cwd: opts.cwd },
    rawOutput: opts.rawOutput,
  };
}

/** A `fileChange` snapshot: per-file diff blocks as content, touched paths as locations. */
export function fileChangeToolCall(opts: {
  toolCallId: string;
  status: ToolCallStatus;
  content: ToolCallContent[];
  locations: ToolCallLocation[];
  rawInput?: unknown;
}): ToolCall {
  return {
    toolCallId: opts.toolCallId,
    title: 'Apply file changes',
    kind: 'edit',
    status: opts.status,
    content: opts.content,
    locations: opts.locations,
    rawInput: opts.rawInput,
  };
}

/** Plan steps (`{step, status}[]`) → `PlanEntry[]`. The live channel spells the running status
 * `inProgress` while rollout rows persist `in_progress` — accept both. */
export function codexPlanEntries(steps: unknown): PlanEntry[] {
  if (!Array.isArray(steps)) return [];
  return steps.reduce<PlanEntry[]>((acc, step) => {
    if (!isRecord(step)) return acc;
    const content = stringField(step, 'step');
    if (content) {
      acc.push({ content, priority: 'medium', status: planStatus(stringField(step, 'status')) });
    }
    return acc;
  }, []);
}

function planStatus(status: string | undefined): PlanEntry['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'in_progress' || status === 'inProgress') return 'in_progress';
  return 'pending';
}
