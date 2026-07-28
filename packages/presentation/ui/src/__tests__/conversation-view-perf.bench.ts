/**
 * Microbenchmarks for the ConversationView pure pipeline (everything the component does
 * before React commit) plus the expensive diff-stats helpers tool headers re-run.
 *
 *   pnpm exec vitest bench packages/presentation/ui/src/__tests__/conversation-view-perf.bench.ts
 */
import type { ToolCall } from '@linkcode/schema';
import { bench, describe } from 'vitest';
import { groupTimeline } from '../chat/activity-groups';
import {
  conversationFlowItems,
  declinedToolCallIds,
  selectPendingPromptItems,
} from '../chat/conversation-prompts';
import { assistantTurnText } from '../chat/conversation-text';
import { toolCallDiffStats } from '../chat/diff-utils';
import { partitionSubagentItems } from '../chat/subagents';
import { splitTurnSegments, turnFileEdits } from '../chat/turn-edits';
import type { ConversationItem, ConversationViewModel } from '../chat/types';

interface LoadShape {
  turns: number;
  toolsPerTurn: number;
  editsPerTurn: number;
  editLines: number;
  assistantParagraphs: number;
}

const SMALL: LoadShape = {
  turns: 20,
  toolsPerTurn: 4,
  editsPerTurn: 1,
  editLines: 40,
  assistantParagraphs: 3,
};

const LARGE: LoadShape = {
  turns: 80,
  toolsPerTurn: 8,
  editsPerTurn: 2,
  editLines: 120,
  assistantParagraphs: 6,
};

function lines(count: number, prefix: string): string {
  let out = '';
  for (let i = 0; i < count; i += 1) out += `${prefix}${i}\n`;
  return out;
}

function toolItem(
  turnId: string,
  id: string,
  kind: ToolCall['kind'],
  content: ToolCall['content'] = [],
): ConversationItem {
  return {
    kind: 'tool',
    id,
    turnId,
    toolCall: {
      toolCallId: id,
      title: `${kind} ${id}`,
      kind,
      status: 'completed',
      content,
    },
  };
}

function buildConversation(shape: LoadShape): ConversationViewModel {
  const items: ConversationItem[] = [];
  for (let t = 0; t < shape.turns; t += 1) {
    const turnId = `turn-${t}`;
    items.push({
      kind: 'message',
      id: `user-${t}`,
      turnId,
      role: 'user',
      blocks: [{ type: 'text', text: `Please work on task ${t}` }],
      isStreaming: false,
    });
    for (let k = 0; k < shape.toolsPerTurn; k += 1) {
      const kind = k % 3 === 0 ? 'read' : k % 3 === 1 ? 'search' : 'execute';
      items.push(
        toolItem(
          turnId,
          `t${t}-tool-${k}`,
          kind,
          kind === 'search'
            ? [{ type: 'content', content: { type: 'text', text: lines(30, `hit:${t}:`) } }]
            : [],
        ),
      );
    }
    for (let e = 0; e < shape.editsPerTurn; e += 1) {
      items.push(
        toolItem(turnId, `t${t}-edit-${e}`, 'edit', [
          {
            type: 'diff',
            path: `src/${t}/${e}.ts`,
            oldText: lines(shape.editLines, `old${t}${e}:`),
            newText: lines(shape.editLines, `new${t}${e}:`),
          },
        ]),
      );
    }
    // One task + nested children so partitionSubagentItems does real work.
    if (t % 4 === 0) {
      const taskId = `t${t}-task`;
      items.push(toolItem(turnId, taskId, 'task'), {
        kind: 'message',
        id: `sub-${t}`,
        turnId,
        role: 'assistant',
        blocks: [{ type: 'text', text: `subagent note ${t}` }],
        isStreaming: false,
        parentToolCallId: taskId,
      });
      const nested = toolItem(turnId, `t${t}-sub-read`, 'read');
      if (nested.kind === 'tool') {
        items.push({
          ...nested,
          toolCall: { ...nested.toolCall, parentToolCallId: taskId },
        });
      }
    }
    const paragraphs: string[] = [];
    for (let p = 0; p < shape.assistantParagraphs; p += 1) {
      paragraphs.push(`## Turn ${t} section ${p}\n\n${lines(12, `p${t}${p}:`)}`);
    }
    items.push({
      kind: 'message',
      id: `asst-${t}`,
      turnId,
      role: 'assistant',
      blocks: [{ type: 'text', text: paragraphs.join('\n') }],
      isStreaming: t === shape.turns - 1,
      model: 'bench-model',
      receivedAt: 1_700_000_000_000 + t,
    });
  }

  return {
    items,
    status: 'running',
    usage: null,
    currentModeId: null,
    approvalPolicy: null,
    currentModel: 'bench-model',
    currentEffort: null,
    availableCommands: null,
    availableModels: null,
    capabilities: null,
    stopReason: null,
    pendingPermissionIds: [],
    pendingQuestionIds: [],
  };
}

/**
 * Mirrors ConversationView's pre-commit work: every agent.event that lands triggers this
 * over the full timeline — not just the streaming tail. Historical turns re-run turnFileEdits
 * (LCS) on every tick while the session is running.
 */
function conversationViewPipeline(conversation: ConversationViewModel): number {
  const { items } = conversation;
  const isThinking = conversation.status === 'running' || conversation.status === 'starting';
  const declined = declinedToolCallIds(items);
  const snapshottedToolIds = new Set(
    items.flatMap((item) => (item.kind === 'tool' ? [item.toolCall.toolCallId] : [])),
  );
  const awaitingApproval = new Set(
    selectPendingPromptItems(conversation).flatMap((item) =>
      item.kind === 'approval' ? [item.toolCall.toolCallId] : [],
    ),
  );
  const segments = splitTurnSegments(conversationFlowItems(items));
  const subagentTasks = items.filter(
    (item): item is Extract<ConversationItem, { kind: 'tool' }> =>
      item.kind === 'tool' && item.toolCall.kind === 'task',
  );
  const allSubagentChildren = partitionSubagentItems(items).childrenByParent;

  let entryCount = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const ended = index < segments.length - 1 || !isThinking;
    const { topLevel } = partitionSubagentItems(segment.items);
    const edits = ended ? turnFileEdits(segment.items) : null;
    const replyText = ended ? assistantTurnText(topLevel) : '';
    const entries = groupTimeline(topLevel);
    entryCount += entries.length + (edits ? edits.files.length : 0) + (replyText ? 1 : 0);
  }

  // Keep the compiler from DCE-ing side work under aggressive opts.
  return (
    entryCount +
    declined.size +
    snapshottedToolIds.size +
    awaitingApproval.size +
    subagentTasks.length +
    allSubagentChildren.size
  );
}

function simulateStreamTicks(conversation: ConversationViewModel, ticks: number): number {
  // Identity-stable history + mutating tail message text, like a streaming chunk each tick.
  const base = conversation.items.slice(0, -1);
  const last = conversation.items.at(-1);
  if (last?.kind !== 'message') return conversationViewPipeline(conversation);

  let acc = 0;
  let text = last.blocks[0]?.type === 'text' ? last.blocks[0].text : '';
  for (let i = 0; i < ticks; i += 1) {
    text += ` token${i}`;
    const next: ConversationViewModel = {
      ...conversation,
      items: [
        ...base,
        {
          ...last,
          blocks: [{ type: 'text', text }],
          isStreaming: true,
        },
      ],
    };
    acc += conversationViewPipeline(next);
  }
  return acc;
}

describe('ConversationView pure pipeline — small (~20 turns)', () => {
  const conversation = buildConversation(SMALL);
  bench(`pipeline once (${conversation.items.length} items)`, () => {
    conversationViewPipeline(conversation);
  });
  bench('simulate 50 stream ticks (full pipeline each)', () => {
    simulateStreamTicks(conversation, 50);
  });
});

describe('ConversationView pure pipeline — large (~80 turns)', () => {
  const conversation = buildConversation(LARGE);
  bench(`pipeline once (${conversation.items.length} items)`, () => {
    conversationViewPipeline(conversation);
  });
  bench('simulate 100 stream ticks (full pipeline each)', () => {
    simulateStreamTicks(conversation, 100);
  });
  bench('turnFileEdits over whole timeline once', () => {
    turnFileEdits(conversation.items);
  });
});

describe('diffLines / toolCallDiffStats isolated', () => {
  const mid = {
    toolCallId: 'd1',
    title: 'Edit',
    kind: 'edit' as const,
    status: 'completed' as const,
    content: [
      {
        type: 'diff' as const,
        path: 'mid.ts',
        oldText: lines(200, 'o:'),
        newText: lines(200, 'n:'),
      },
    ],
  };
  const nearCap = {
    toolCallId: 'd2',
    title: 'Edit',
    kind: 'edit' as const,
    status: 'completed' as const,
    content: [
      {
        type: 'diff' as const,
        path: 'big.ts',
        // 500×500 = 250k cells — just under the fallback gate
        oldText: lines(500, 'o:'),
        newText: lines(500, 'n:'),
      },
    ],
  };
  const overCap = {
    toolCallId: 'd3',
    title: 'Edit',
    kind: 'edit' as const,
    status: 'completed' as const,
    content: [
      {
        type: 'diff' as const,
        path: 'huge.ts',
        oldText: lines(600, 'o:'),
        newText: lines(600, 'n:'),
      },
    ],
  };

  bench('toolCallDiffStats 200×200 lines', () => {
    toolCallDiffStats(mid);
  });
  bench('toolCallDiffStats 500×500 lines (near LCS cap)', () => {
    toolCallDiffStats(nearCap);
  });
  bench('toolCallDiffStats 600×600 lines (fallback path)', () => {
    toolCallDiffStats(overCap);
  });
});
