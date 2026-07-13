import type { ConversationItem } from '@linkcode/client-core';
import { buildConversation } from '@linkcode/client-core';
import type {
  AgentEvent,
  PermissionOption,
  Plan,
  Question,
  ToolCall,
  ToolCallContent,
  ToolCallStatus,
  ToolCallUpdate,
} from '@linkcode/schema';
import { structuredPatch } from 'diff';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { blockquote, capLines, contentToMarkdown, fence } from './blocks';

/**
 * ConversationItem → neutral Markdown, platform-agnostic and React-free. The IM bridges own the
 * last mile (Telegram MarkdownV2 escaping, length splitting, buttons); this layer only decides
 * what a conversation reads like as chat messages.
 *
 * Streaming: rendering is pure over the current item snapshot, so a bridge re-renders a turn on
 * every event and edits the previously sent message when the Markdown changed.
 */

export interface RenderOptions {
  /** Cap fenced code/diff blocks at this many lines (an elision note replaces the rest). */
  maxCodeBlockLines?: number;
}

export interface RenderedItem {
  id: string;
  kind: ConversationItem['kind'];
  markdown: string;
}

/** One conversation turn — the "one turn, one IM message" unit. */
export interface RenderedTurn {
  turnId: string | null;
  /** The user prompt that opened the turn; null for items before any prompt. */
  userMarkdown: string | null;
  /** Everything the agent produced during the turn, joined into one message's Markdown. */
  agentMarkdown: string;
  items: RenderedItem[];
}

const TOOL_STATUS_ICON: Record<ToolCallStatus, string> = {
  pending: '▫\u{FE0F}',
  in_progress: '▪\u{FE0F}',
  completed: '✅',
  failed: '❌',
};

function toolContentMarkdown(content: ToolCallContent, opts: RenderOptions): string {
  switch (content.type) {
    case 'content': {
      const text = contentToMarkdown([content.content]);
      if (text.length === 0) return '';
      // Tool output is machine text (logs, file contents) — fence it unless it is already fenced.
      return content.content.type === 'text' && !text.startsWith('```')
        ? fence(capLines(text, opts.maxCodeBlockLines))
        : text;
    }
    case 'diff': {
      const patch = structuredPatch(
        content.path,
        content.path,
        content.oldText ?? '',
        content.newText,
      );
      const lines = patch.hunks.flatMap((hunk) => [
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
        ...hunk.lines,
      ]);
      return `✏\u{FE0F} \`${content.path}\`\n${fence(capLines(lines.join('\n'), opts.maxCodeBlockLines), 'diff')}`;
    }
    case 'terminal':
      // Terminal buffers live on the host; over IM only the fact of the terminal is visible.
      return '🖥\u{FE0F} *terminal session*';
    default:
      return '';
  }
}

export function toolCallMarkdown(toolCall: ToolCall, opts: RenderOptions = {}): string {
  const parts = [`${TOOL_STATUS_ICON[toolCall.status]} *${toolCall.title || toolCall.kind}*`];
  for (const content of toolCall.content) {
    const text = toolContentMarkdown(content, opts);
    if (text.length > 0) parts.push(text);
  }
  return parts.join('\n');
}

const PLAN_STATUS_ICON = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
} as const;

export function planMarkdown(plan: Plan): string {
  const entries = plan.entries.map((entry) => `${PLAN_STATUS_ICON[entry.status]} ${entry.content}`);
  return ['📋 **Plan**', ...entries].join('\n');
}

export function permissionMarkdown(
  toolCall: ToolCallUpdate,
  options: readonly PermissionOption[],
): string {
  const title = toolCall.title ?? toolCall.toolCallId;
  const named = options.map((option) => `• ${option.name}`);
  return [`🔐 **Permission required** — ${title}`, ...named].join('\n');
}

/** The agent's structured ask (AskUserQuestion): each question with its options as bullets. */
export function questionMarkdown(questions: readonly Question[]): string {
  const parts: string[] = ['❓ **Question**'];
  for (const question of questions) {
    parts.push(question.prompt);
    appendArrayInPlace(
      parts,
      question.options.map((option) => `• ${option.label}`),
    );
  }
  return parts.join('\n');
}

export function renderItem(item: ConversationItem, opts: RenderOptions = {}): string {
  switch (item.kind) {
    case 'message':
      return contentToMarkdown(item.blocks);
    case 'reasoning': {
      const text = contentToMarkdown(item.blocks);
      return text.length === 0 ? '' : blockquote(text);
    }
    case 'tool':
      return toolCallMarkdown(item.toolCall, opts);
    case 'plan':
      return planMarkdown(item.plan);
    case 'approval':
      return permissionMarkdown(item.toolCall, item.options);
    case 'question':
      return questionMarkdown(item.questions);
    case 'compaction':
      // Context compaction is a host-side bookkeeping moment; over IM a marker line suffices.
      return '♻\u{FE0F} *context compacted*';
    case 'error':
      return `⚠\u{FE0F} **Error:** ${item.message}${item.code === undefined ? '' : ` (${item.code})`}`;
    default:
      return '';
  }
}

/** Group a conversation's items into turns, each rendered as one IM message worth of Markdown. */
export function renderTurns(
  items: readonly ConversationItem[],
  opts: RenderOptions = {},
): RenderedTurn[] {
  const turns: RenderedTurn[] = [];
  for (const item of items) {
    let turn = turns.at(-1);
    if (turn?.turnId !== item.turnId) {
      turn = { turnId: item.turnId, userMarkdown: null, agentMarkdown: '', items: [] };
      turns.push(turn);
    }
    const markdown = renderItem(item, opts);
    if (markdown.length === 0) continue;
    if (item.kind === 'message' && item.role === 'user') {
      turn.userMarkdown =
        turn.userMarkdown === null ? markdown : `${turn.userMarkdown}\n\n${markdown}`;
      continue;
    }
    turn.items.push({ id: item.id, kind: item.kind, markdown });
    turn.agentMarkdown =
      turn.agentMarkdown.length === 0 ? markdown : `${turn.agentMarkdown}\n\n${markdown}`;
  }
  return turns;
}

/** Render a whole conversation as one Markdown transcript (seeding / stale-guard sync replay). */
export function renderConversation(
  items: readonly ConversationItem[],
  opts: RenderOptions = {},
): string {
  const parts: string[] = [];
  for (const turn of renderTurns(items, opts)) {
    if (turn.userMarkdown !== null) parts.push(`👤 ${turn.userMarkdown}`);
    if (turn.agentMarkdown.length > 0) parts.push(turn.agentMarkdown);
  }
  return parts.join('\n\n');
}

/** Convenience: fold a raw event stream and render the resulting transcript. */
export function renderAgentEvents(events: readonly AgentEvent[], opts: RenderOptions = {}): string {
  return renderConversation(buildConversation(events).items, opts);
}
