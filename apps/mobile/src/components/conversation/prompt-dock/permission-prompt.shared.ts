import type { PermissionOption, PermissionOutcome, ToolCallUpdate } from '@linkcode/schema';

export interface PermissionPromptProps {
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
  responding: boolean;
  onRespond: (outcome: PermissionOutcome) => void;
}

export const DANGER_KINDS = new Set(['reject_once', 'reject_always']);

export interface DetailRow {
  key: string;
  value: string;
}

/** The most identifying facts of the pending call: touched paths, then command/url inputs.
 * Raw input JSON is deliberately not dumped — an unrecognized tool still shows its scalar
 * fields through `locations`/`content`, and the model keeps the rest. */
export function detailRows(toolCall: ToolCallUpdate): DetailRow[] {
  const rows: DetailRow[] = [];
  if (toolCall.locations != null) {
    for (let i = 0, len = toolCall.locations.length; i < len; i++) {
      const location = toolCall.locations[i];
      rows.push({ key: `loc:${location.path}`, value: location.path });
    }
  }
  if (toolCall.content != null) {
    for (let i = 0, len = toolCall.content.length; i < len; i++) {
      const content = toolCall.content[i];
      if (content.type === 'diff' && !rows.some((row) => row.value === content.path)) {
        rows.push({ key: `diff:${content.path}`, value: content.path });
      }
    }
  }
  const input = toolCall.rawInput;
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    const pathKeys = ['file_path', 'path', 'notebook_path', 'filePath'];
    for (let i = 0, len = pathKeys.length; i < len; i++) {
      const key = pathKeys[i];
      const value = record[key];
      if (typeof value === 'string' && !rows.some((row) => row.value === value)) {
        rows.push({ key: `path:${key}`, value });
        break;
      }
    }
    if (typeof record.command === 'string') rows.push({ key: 'command', value: record.command });
    if (typeof record.url === 'string') rows.push({ key: 'url', value: record.url });
  }
  return rows;
}
