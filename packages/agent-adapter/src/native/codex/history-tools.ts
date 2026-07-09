import type {
  Plan,
  PlanEntry,
  ToolCall,
  ToolCallContent,
  ToolCallLocation,
} from '@linkcode/schema';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { isRecord, stringField, textFromUnknown } from '../../history-util';
import { toolKindFromName } from '../../util';

/**
 * Maps rollout tool rows to the same `ToolCall` shapes the live adapter emits (`adapter.ts`
 * `handleItem`), so a replayed transcript renders like the live turn did: `exec_command` titles the
 * command line and carries the parsed output body, `apply_patch` reconstructs per-hunk diffs from
 * codex's `*** Begin Patch` envelope (the app-server's unified diff is never persisted), and
 * `update_plan` replays as the `plan` event the live turn surfaces instead of a tool row.
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
          toolCall: {
            // Live parity: fileChange renders as 'Apply file changes' with per-file diff blocks.
            toolCallId: callId,
            title: 'Apply file changes',
            kind: 'edit',
            status: 'in_progress',
            content: view.content,
            locations: view.locations,
            rawInput: input,
          },
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
    const cmd = stringField(args, 'cmd');
    return {
      toolCall: {
        toolCallId: callId,
        title: cmd ?? 'command',
        kind: 'execute',
        status: 'in_progress',
        content: [],
        // Live parity: commandExecution reports { command, cwd }.
        rawInput: { command: cmd, cwd: stringField(args, 'workdir') },
      },
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

  if (existing?.kind === 'edit' && existing.content.length > 0) {
    // The diff blocks from the announce are the record; the receipt text only matters on failure.
    const failed = parsed.failed || (parsed.exitCode !== undefined && parsed.exitCode !== 0);
    return {
      ...existing,
      status: failed ? 'failed' : 'completed',
      content: failed ? [...existing.content, ...textContent(parsed.body)] : existing.content,
      rawOutput: raw,
    };
  }

  return {
    toolCallId: callId,
    // The announce can sit beyond this read's page window; fall back to first-sight defaults.
    title: existing?.title ?? callId,
    kind: existing?.kind ?? 'other',
    status: parsed.failed ? 'failed' : 'completed',
    content: textContent(parsed.body),
    rawInput: existing?.rawInput,
    // Live parity: commandExecution reports the exit code as rawOutput.
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

function textContent(text: string): ToolCallContent[] {
  if (text.length === 0) return [];
  return [{ type: 'content', content: { type: 'text', text } }];
}

const EXIT_CODE_RE = /^(?:Process exited with code|Exit code:) (\d+)$/m;
const OUTPUT_MARKER = '\nOutput:\n';

/**
 * Unwrap the freeform-exec output envelope (`Chunk ID: … / Wall time: … / Process exited with
 * code N / Output:\n<body>`; apply_patch uses `Exit code: N` for the same role). Cancelled runs
 * persist `aborted by user after Ns` and declined ones `<tool> failed for \`…\`: …` — both settle
 * as failed with the raw text as the record.
 */
function parseCodexToolOutput(output: string): {
  body: string;
  exitCode?: number;
  failed: boolean;
} {
  if (output.startsWith('aborted by user') || output.split('\n', 1)[0].includes(' failed for `')) {
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
  if (!isRecord(args) || !Array.isArray(args.plan)) return null;
  const entries = args.plan.reduce<PlanEntry[]>((acc, step) => {
    if (!isRecord(step)) return acc;
    const content = stringField(step, 'step');
    if (content) {
      acc.push({ content, priority: 'medium', status: planStatus(stringField(step, 'status')) });
    }
    return acc;
  }, []);
  return entries.length > 0 ? { entries } : null;
}

/** Rollout rows persist snake_case (`in_progress`); the live channel camelCases (`inProgress`). */
function planStatus(status: string | undefined): PlanEntry['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'in_progress' || status === 'inProgress') return 'in_progress';
  return 'pending';
}

interface ApplyPatchView {
  content: ToolCallContent[];
  locations: ToolCallLocation[];
}

/**
 * Reconstruct per-file diff blocks from codex's `*** Begin Patch` envelope — the only edit record
 * the rollout persists. Update-file hunks split into old side (context + removed) and new side
 * (context + added), the same shape `diffContentFromUnified` produces for the live `fileChange`
 * item; adds render as all-new content and deletes/renames as receipt text, mirroring the live
 * mapping. Returns null when no file section parses (the caller falls back to a generic tool row).
 */
export function applyPatchToolView(input: string): ApplyPatchView | null {
  if (!input.startsWith('*** Begin Patch')) return null;
  const content: ToolCallContent[] = [];
  const locations: ToolCallLocation[] = [];
  let updatePath: string | null = null;
  let oldLines: string[] | null = null;
  let newLines: string[] | null = null;
  let addLines: string[] | null = null;

  const flush = (): void => {
    if (addLines !== null && updatePath !== null) {
      content.push({ type: 'diff', path: updatePath, newText: addLines.join('\n') });
    } else if (
      updatePath !== null &&
      oldLines !== null &&
      newLines !== null &&
      (oldLines.length > 0 || newLines.length > 0)
    ) {
      content.push({
        type: 'diff',
        path: updatePath,
        oldText: oldLines.length > 0 ? oldLines.join('\n') : undefined,
        newText: newLines.join('\n'),
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
      locations.push({ path: updatePath });
      oldLines = [];
      newLines = [];
      continue;
    }
    if (line.startsWith('*** Add File: ')) {
      flush();
      updatePath = line.slice('*** Add File: '.length);
      locations.push({ path: updatePath });
      addLines = [];
      continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      flush();
      updatePath = null;
      const path = line.slice('*** Delete File: '.length);
      locations.push({ path });
      appendArrayInPlace(content, textContent(`Deleted ${path}`));
      continue;
    }
    if (line.startsWith('*** Move to: ')) {
      // A rename inside an update: cite (and label the diff with) the destination, like live.
      const dest = line.slice('*** Move to: '.length);
      if (updatePath !== null && locations.at(-1)?.path === updatePath) {
        locations[locations.length - 1] = { path: dest };
      }
      updatePath = dest;
      continue;
    }
    if (line.startsWith('*** ')) continue; // Begin/End Patch, End of File markers
    if (line.startsWith('@@')) {
      // Hunk boundary within the current update file.
      if (updatePath !== null && addLines === null) {
        flush();
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
