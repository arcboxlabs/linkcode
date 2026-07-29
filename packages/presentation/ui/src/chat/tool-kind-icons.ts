import type { ToolCall } from '@linkcode/schema';
import {
  BotIcon,
  FileOutputIcon,
  FileTextIcon,
  GlobeIcon,
  PencilIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
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
  search: SearchIcon,
  execute: TerminalIcon,
  think: SparklesIcon,
  fetch: GlobeIcon,
  task: BotIcon,
  other: WrenchIcon,
};
