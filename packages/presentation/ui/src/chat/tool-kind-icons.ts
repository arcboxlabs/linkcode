import type { ToolCall } from '@linkcode/schema';
import {
  BotIcon,
  FileOutputIcon,
  FileTextIcon,
  GlobeIcon,
  PencilIcon,
  SparklesIcon,
  TerminalIcon,
  TextSearchIcon,
  Trash2Icon,
  WrenchIcon,
} from 'lucide-react';

export const TOOL_KIND_ICONS: Record<
  ToolCall['kind'],
  React.ComponentType<{ className?: string }>
> = {
  read: FileTextIcon,
  edit: PencilIcon,
  delete: Trash2Icon,
  move: FileOutputIcon,
  search: TextSearchIcon,
  execute: TerminalIcon,
  think: SparklesIcon,
  fetch: GlobeIcon,
  task: BotIcon,
  other: WrenchIcon,
};
