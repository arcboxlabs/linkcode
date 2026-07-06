import type { ToolCall } from '@linkcode/schema';
import {
  BrainIcon,
  FileOutputIcon,
  FileTextIcon,
  GlobeIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  Trash2Icon,
  WrenchIcon,
} from 'lucide-react';

export function hasToolBody(toolCall: ToolCall): boolean {
  return Boolean(
    toolCall.content.length || toolCall.rawInput !== undefined || toolCall.rawOutput !== undefined,
  );
}

export const TOOL_KIND_ICONS: Record<
  ToolCall['kind'],
  React.ComponentType<{ className?: string }>
> = {
  read: FileTextIcon,
  edit: PencilIcon,
  delete: Trash2Icon,
  move: FileOutputIcon,
  search: SearchIcon,
  execute: TerminalIcon,
  think: BrainIcon,
  fetch: GlobeIcon,
  other: WrenchIcon,
};
