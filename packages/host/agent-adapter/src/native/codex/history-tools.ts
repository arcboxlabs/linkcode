import type { Plan, ToolCall, ToolCallContent, ToolCallLocation } from '@linkcode/schema';
import { isRecord, stringField, textFromUnknown } from '../../history-util';
import { toolKindFromName } from '../../util';
import {
  CODEX_PLAN_ID,
  codexPlanEntries,
  execToolCall,
  fileChangeToolCall,
  textContent,
} from './tool-view';

/**
 * Maps rollout tool rows to the same `ToolCall` shapes the live adapter emits (`adapter.ts`
 * `handleItem`) so a replayed transcript renders like the live turn did: `apply_patch`
 * reconstructs per-hunk diffs from codex's `*** Begin Patch` envelope (the app-server's unified
 * diff is never persisted); `update_plan` replays as the live `plan` event instead of a tool row.
 */

/** An announce row mapped to what the live turn emitted for it. */
export type CodexToolAnnounce = { toolCall: ToolCall } | { plan: Plan };

export function codexToolAnnounce(
  callId: string,
  payload: Record<string, unknown>,
): CodexToolAnnounce {
  const payloadType = stringField(payload, 'type');
  const name = stringField(payload, 'name');

  if (payloadType === 'custom_tool_call') {
    const input = stringField(payload, 'input') ?? '';
    if (name === 'apply_patch') {
      const view = applyPatchToolView(input);
      if (view) {
        return {
          toolCall: fileChangeToolCall({
            toolCallId: callId,
            status: 'in_progress',
            content: view.content,
            locations: view.locations,
            rawInput: input,
          }),
        };
      }
    }
    return {
      toolCall: {
        toolCallId: callId,
        title: name ?? 'tool',
        kind: name === undefined ? 'other' : toolKindFromName(name),
        status: 'in_progress',
        content: [],
        rawInput: payload.input,
      },
    };
  }

  if (payloadType === 'local_shell_call') {
    // Pre-0.140 shell announce: `action.command` is the argv array.
    const action = isRecord(payload.action) ? payload.action : undefined;
    const command = Array.isArray(action?.command)
      ? action.command.filter((part): part is string => typeof part === 'string').join(' ')
      : undefined;
    return {
      toolCall: {
        toolCallId: callId,
        title: command ?? 'command',
        kind: 'execute',
        status: 'in_progress',
        content: [],
        rawInput: payload.action,
      },
    };
  }

  // function_call: JSON-encoded `arguments`.
  const args = parseArguments(payload);
  if (name === 'update_plan') {
    const plan = planFromArgs(args);
    if (plan) return { plan };
  }
  if (name === 'exec_command' && isRecord(args)) {
    return {
      toolCall: execToolCall({
        toolCallId: callId,
        command: stringField(args, 'cmd'),
        cwd: stringField(args, 'workdir'),
        status: 'in_progress',
      }),
    };
  }
  if (name === 'write_stdin') {
    // Input fed to a running freeform-exec session — an execute step, not the edit the
    // name-regex heuristic would guess from 'write'.
    return {
      toolCall: {
        toolCallId: callId,
        title: 'write_stdin',
        kind: 'execute',
        status: 'in_progress',
        content: [],
        rawInput: args,
      },
    };
  }
  return {
    toolCall: {
      toolCallId: callId,
      title: name ?? 'tool',
      kind: name === undefined ? 'other' : toolKindFromName(name),
      status: 'in_progress',
      content: [],
      rawInput: args,
    },
  };
}

/** Settle an output row into the final snapshot, keeping the announce's diff content for edits and
 * unwrapping the freeform-exec output envelope for everything else. */
export function codexToolSettle(
  callId: string,
  payload: Record<string, unknown>,
  existing: ToolCall | undefined,
): ToolCall {
  const raw = payload.output;
  const output = typeof raw === 'string' ? raw : textFromUnknown(raw);
  const parsed = parseCodexToolOutput(output);

  if (existing) {
    if (existing.content.length > 0) {
      // A content-bearing announce (apply_patch's reconstructed diffs) is the record — live
      // fileChange shows diffs, never the apply receipt. A nonzero exit here means the patch
      // did NOT apply: fail the call and append the receipt text as the only explanation.
      const failed = parsed.failed || (parsed.exitCode !== undefined && parsed.exitCode !== 0);
      return {
        ...existing,
        status: failed ? 'failed' : 'completed',
        content: failed ? [...existing.content, ...textContent(parsed.body)] : existing.content,
        rawOutput: raw,
      };
    }
    // A nonzero exit code deliberately stays 'completed' — live parity: the app-server reserves
    // 'failed' for declined/aborted runs, and the exit code travels as rawOutput.
    return {
      ...existing,
      status: parsed.failed ? 'failed' : 'completed',
      content: textContent(parsed.body),
      rawOutput: parsed.exitCode ?? raw,
    };
  }

  // No announce: codex maps the whole rollout before paging, so this only happens when the
  // announce row was torn/corrupt (readJsonlFile skips it) — settle with first-sight defaults.
  return {
    toolCallId: callId,
    title: callId,
    kind: 'other',
    status: parsed.failed ? 'failed' : 'completed',
    content: textContent(parsed.body),
    rawOutput: parsed.exitCode ?? raw,
  };
}

function parseArguments(payload: Record<string, unknown>): unknown {
  const args = stringField(payload, 'arguments');
  if (args === undefined) return payload.input ?? payload.action;
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return args;
  }
}

const EXIT_CODE_RE = /^(?:Process exited with code|Exit code:) (\d+)$/m;
const OUTPUT_MARKER = '\nOutput:\n';
/** Declined runs persist `<tool> failed for \`cmd\`: reason` — anchored so a command whose own
 * output happens to contain the phrase is not misread as a decline. */
const DECLINED_OUTPUT_RE = /^\w+ failed for `/;

/**
 * Unwrap the freeform-exec output envelope (`Chunk ID: … / Process exited with code N /
 * Output:\n<body>`; apply_patch uses `Exit code: N`). Cancelled runs persist `aborted by user
 * after Ns` and declined ones `<tool> failed for \`…\`: …` — both settle as failed with the raw
 * text as the record.
 */
function parseCodexToolOutput(output: string): {
  body: string;
  exitCode?: number;
  failed: boolean;
} {
  if (output.startsWith('aborted by user') || DECLINED_OUTPUT_RE.test(output)) {
    return { body: output, failed: true };
  }
  if (output.startsWith('Chunk ID:') || output.startsWith('Exit code:')) {
    const exitMatch = EXIT_CODE_RE.exec(output);
    const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : undefined;
    const marker = output.indexOf(OUTPUT_MARKER);
    const body = marker >= 0 ? output.slice(marker + OUTPUT_MARKER.length) : output;
    return { body, exitCode, failed: false };
  }
  return { body: output, failed: false };
}

function planFromArgs(args: unknown): Plan | null {
  if (!isRecord(args)) return null;
  const entries = codexPlanEntries(args.plan);
  return entries.length > 0 ? { planId: CODEX_PLAN_ID, entries } : null;
}

interface ApplyPatchView {
  content: ToolCallContent[];
  locations: ToolCallLocation[];
}

/**
 * Reconstruct per-file diff blocks from codex's `*** Begin Patch` envelope — the only edit record
 * the rollout persists. Update hunks split into old/new sides (the same shape
 * `diffContentFromUnified` produces live); adds render all-new, deletes/renames as receipt text.
 * Returns null when no file section parses (the caller falls back to a generic tool row).
 */
export function applyPatchToolView(input: string): ApplyPatchView | null {
  if (!input.startsWith('*** Begin Patch')) return null;
  const content: ToolCallContent[] = [];
  const locations: ToolCallLocation[] = [];
  let updatePath: string | null = null;
  let oldPath: string | null = null;
  let change: 'modify' | 'add' | 'delete' | 'move' = 'modify';
  let oldLines: string[] | null = null;
  let newLines: string[] | null = null;
  let addLines: string[] | null = null;

  const flush = (): void => {
    if (addLines !== null && updatePath !== null) {
      content.push({ type: 'diff', change, path: updatePath, newText: addLines.join('\n') });
    } else if (
      updatePath !== null &&
      oldLines !== null &&
      newLines !== null &&
      (oldLines.length > 0 || newLines.length > 0 || change === 'move')
    ) {
      content.push({
        type: 'diff',
        change,
        path: updatePath,
        oldPath: oldPath ?? undefined,
        oldText: oldLines.length > 0 ? oldLines.join('\n') : undefined,
        newText: newLines.length > 0 ? newLines.join('\n') : undefined,
      });
    }
    oldLines = null;
    newLines = null;
    addLines = null;
  };

  const lines = input.split('\n');
  // An envelope ending in '\n' splits into a trailing '' that is not a content line.
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (line.startsWith('*** Update File: ')) {
      flush();
      updatePath = line.slice('*** Update File: '.length);
      oldPath = null;
      change = 'modify';
      locations.push({ path: updatePath });
      oldLines = [];
      newLines = [];
      continue;
    }
    if (line.startsWith('*** Add File: ')) {
      flush();
      updatePath = line.slice('*** Add File: '.length);
      oldPath = null;
      change = 'add';
      locations.push({ path: updatePath });
      addLines = [];
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      flush();
      updatePath = line.slice('*** Delete File: '.length);
      oldPath = null;
      change = 'delete';
      locations.push({ path: updatePath });
      content.push({ type: 'diff', change, path: updatePath });
      updatePath = null;
      continue;
    }
    if (line.startsWith('*** Move to: ')) {
      // A rename inside an update: cite (and label the diff with) the destination, like live.
      const dest = line.slice('*** Move to: '.length);
      if (updatePath !== null && locations.at(-1)?.path === updatePath) {
        locations[locations.length - 1] = { path: dest };
      }
      oldPath = updatePath;
      updatePath = dest;
      change = 'move';
      continue;
    }
    if (line.startsWith('*** ')) continue; // Begin/End Patch, End of File markers
    if (line.startsWith('@@')) {
      // Hunk boundary within the current update file.
      if (updatePath !== null && addLines === null) {
        if ((oldLines?.length ?? 0) > 0 || (newLines?.length ?? 0) > 0) flush();
        // flush() cleared the file cursor's buffers, not the file itself.
        oldLines = [];
        newLines = [];
      }
      continue;
    }
    if (addLines !== null) {
      if (line[0] === '+') addLines.push(line.slice(1));
      continue;
    }
    if (oldLines === null || newLines === null) continue;
    if (line[0] === '+') {
      newLines.push(line.slice(1));
    } else if (line[0] === '-') {
      oldLines.push(line.slice(1));
    } else {
      // Context: some producers strip the leading space off blank lines, leaving ''.
      const text = line[0] === ' ' ? line.slice(1) : line;
      oldLines.push(text);
      newLines.push(text);
    }
  }
  flush();

  return locations.length > 0 ? { content, locations } : null;
}
