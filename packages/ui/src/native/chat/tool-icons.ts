import type { ToolCall } from '@linkcode/schema';
import type { LucideIcon } from 'lucide-react-native';
import {
  Bot,
  Brain,
  FileOutput,
  FileText,
  Globe,
  Pencil,
  Search,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react-native';

/** Native mirror of the web half's `TOOL_KIND_ICONS` (lucide-react) — same glyph per kind. */
export const TOOL_KIND_ICONS: Record<ToolCall['kind'], LucideIcon> = {
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  move: FileOutput,
  search: Search,
  execute: Terminal,
  think: Brain,
  fetch: Globe,
  task: Bot,
  other: Wrench,
};
