import type { ToolCall } from '@linkcode/schema';
import type { ArtifactNavigation } from './artifacts/context';
import { fileBasename } from './artifacts/file-kind';
import { recordValue, stringValue, TOOL_PATH_KEYS, toolCallFilePath } from './tool-result-content';

const MOVE_SOURCE_KEYS = ['source', 'from', 'old_path', 'oldPath', ...TOOL_PATH_KEYS] as const;
const MOVE_DESTINATION_KEYS = ['destination', 'to', 'new_path', 'newPath', 'move_path'] as const;

export interface ToolCallFilePresentation {
  /** Representative file used for the preview icon. */
  path: string;
  /** Compact outer-row context. */
  label: string;
  /** Unshortened context shown only in a tooltip. */
  tooltip: string;
  /** Text receipts cannot be paired with one file when an adapter reports several locations. */
  ambiguous: boolean;
  /** File viewer for a surviving target; review surface for deletes and multi-file changes. */
  navigation?: ArtifactNavigation;
}

function filePaths(toolCall: ToolCall): string[] {
  const paths = new Set(toolCall.locations?.map((location) => location.path));
  for (const content of toolCall.content) {
    if (content.type === 'diff') paths.add(content.path);
  }
  const fallback = toolCallFilePath(toolCall);
  if (fallback) paths.add(fallback);
  return [...paths];
}

function isCompletedDeletion(toolCall: ToolCall, path: string): boolean {
  if (toolCall.status !== 'completed') return false;
  if (toolCall.kind === 'delete') return true;

  // Codex normalizes every fileChange/apply_patch operation as `edit`; its schema loses the
  // delete kind, leaving either an empty new side or the exact history receipt as the signal.
  return toolCall.content.some((content) => {
    if (content.type === 'diff') {
      return content.path === path && content.oldText !== undefined && content.newText.length === 0;
    }
    return content.type === 'content' && content.content.type === 'text'
      ? content.content.text === `Deleted ${path}`
      : false;
  });
}

/** Adapter-tolerant file identity and navigation projected once for every transcript surface. */
export function toolCallFilePresentation(toolCall: ToolCall): ToolCallFilePresentation | undefined {
  if (
    toolCall.kind !== 'read' &&
    toolCall.kind !== 'edit' &&
    toolCall.kind !== 'delete' &&
    toolCall.kind !== 'move'
  ) {
    return undefined;
  }

  if (toolCall.kind === 'move') {
    const input = recordValue(toolCall.rawInput);
    const source = stringValue(input, MOVE_SOURCE_KEYS);
    const destination = stringValue(input, MOVE_DESTINATION_KEYS);
    if (source && destination) {
      // Pi/OpenCode-style move inputs keep the source in `path`; until the call completes (and
      // after a failure) that source is the file which still exists. Completed moves open the target.
      const path = toolCall.status === 'completed' ? destination : source;
      return {
        path,
        label: `${fileBasename(source)} → ${fileBasename(destination)}`,
        tooltip: `${source} → ${destination}`,
        ambiguous: false,
        navigation: { kind: 'file', path },
      };
    }
  }

  const paths = filePaths(toolCall);
  const path = paths[0];
  if (!path) return undefined;
  const ambiguous = paths.length > 1;
  const location = toolCall.locations?.find((item) => item.path === path);
  const suffix = !ambiguous && location?.line !== undefined ? `:${location.line}` : '';
  const deleted = !ambiguous && isCompletedDeletion(toolCall, path);
  const navigation: ArtifactNavigation | undefined =
    deleted || (ambiguous && toolCall.status === 'completed' && toolCall.kind !== 'read')
      ? { kind: 'review' }
      : ambiguous
        ? undefined
        : { kind: 'file', path };
  return {
    path,
    label: ambiguous
      ? paths.map((candidate) => fileBasename(candidate)).join(', ')
      : `${fileBasename(path)}${suffix}`,
    tooltip: ambiguous ? paths.join(', ') : `${path}${suffix}`,
    ambiguous,
    navigation,
  };
}

/** Structured diff blocks identify their own path, unlike adapter text receipts. */
export function toolCallDiffNavigation(
  toolCall: ToolCall,
  path: string,
  newText: string,
): ArtifactNavigation {
  return toolCall.status === 'completed' && newText.length === 0
    ? { kind: 'review' }
    : { kind: 'file', path };
}
