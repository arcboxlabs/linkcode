/**
 * One-shot timing report for ConversationView's pure pre-commit pipeline.
 *
 *   pnpm test packages/presentation/ui/src/__tests__/conversation-view-perf.report.test.ts
 */

import type { ToolCall } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
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
  label: string;
  turns: number;
  toolsPerTurn: number;
  editsPerTurn: number;
  editLines: number;
  streamTicks: number;
}

const SHAPES: LoadShape[] = [
  {
    label: 'small (~20 turns)',
    turns: 20,
    toolsPerTurn: 4,
    editsPerTurn: 1,
    editLines: 40,
    streamTicks: 50,
  },
  {
    label: 'large (~80 turns)',
    turns: 80,
    toolsPerTurn: 8,
    editsPerTurn: 2,
    editLines: 120,
    streamTicks: 100,
  },
];

function lines(count: number, prefix: string): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) parts.push(prefix + String(i));
  return parts.join('\n') + '\n';
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
      title: kind + ' ' + id,
      kind,
      status: 'completed',
      content,
    },
  };
}

function buildConversation(shape: LoadShape): ConversationViewModel {
  const items: ConversationItem[] = [];
  for (let t = 0; t < shape.turns; t += 1) {
    const turnId = 'turn-' + String(t);
    items.push({
      kind: 'message',
      id: 'user-' + String(t),
      turnId,
      role: 'user',
      blocks: [{ type: 'text', text: 'Please work on task ' + String(t) }],
      isStreaming: false,
    });
    for (let k = 0; k < shape.toolsPerTurn; k += 1) {
      const kind = k % 3 === 0 ? 'read' : k % 3 === 1 ? 'search' : 'execute';
      items.push(
        toolItem(
          turnId,
          't' + String(t) + '-tool-' + String(k),
          kind,
          kind === 'search'
            ? [
                {
                  type: 'content',
                  content: { type: 'text', text: lines(30, 'hit:' + String(t) + ':') },
                },
              ]
            : [],
        ),
      );
    }
    for (let e = 0; e < shape.editsPerTurn; e += 1) {
      items.push(
        toolItem(turnId, 't' + String(t) + '-edit-' + String(e), 'edit', [
          {
            type: 'diff',
            path: 'src/' + String(t) + '/' + String(e) + '.ts',
            oldText: lines(shape.editLines, 'old' + String(t) + String(e) + ':'),
            newText: lines(shape.editLines, 'new' + String(t) + String(e) + ':'),
          },
        ]),
      );
    }
    if (t % 4 === 0) {
      const taskId = 't' + String(t) + '-task';
      items.push(toolItem(turnId, taskId, 'task'));
      items.push({
        kind: 'message',
        id: 'sub-' + String(t),
        turnId,
        role: 'assistant',
        blocks: [{ type: 'text', text: 'subagent note ' + String(t) }],
        isStreaming: false,
        parentToolCallId: taskId,
      });
      const nested = toolItem(turnId, 't' + String(t) + '-sub-read', 'read');
      if (nested.kind === 'tool') {
        items.push({
          ...nested,
          toolCall: { ...nested.toolCall, parentToolCallId: taskId },
        });
      }
    }
    items.push({
      kind: 'message',
      id: 'asst-' + String(t),
      turnId,
      role: 'assistant',
      blocks: [{ type: 'text', text: lines(36, 'asst-' + String(t) + ':') }],
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
 * Full pre-commit work ConversationView does on every conversation snapshot.
 * Matches conversation-view.tsx: trailers only for ended turns — while status is running,
 * every historical turn still re-runs LCS; only the in-flight turn skips.
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
  let entryCount = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const ended = index < segments.length - 1 || !isThinking;
    const { topLevel } = partitionSubagentItems(segment.items);
    const edits = ended ? turnFileEdits(segment.items) : null;
    const replyText = ended ? assistantTurnText(topLevel) : '';
    entryCount += groupTimeline(topLevel).length + (edits ? 1 : 0) + (replyText ? 1 : 0);
  }
  return entryCount + declined.size + snapshottedToolIds.size + awaitingApproval.size;
}

/** Pipeline without turnFileEdits — isolates grouping/partition from LCS cost. */
function conversationViewPipelineNoEdits(conversation: ConversationViewModel): number {
  const { items } = conversation;
  declinedToolCallIds(items);
  const segments = splitTurnSegments(conversationFlowItems(items));
  let entryCount = 0;
  for (const segment of segments) {
    const { topLevel } = partitionSubagentItems(segment.items);
    entryCount += groupTimeline(topLevel).length + (assistantTurnText(topLevel) ? 1 : 0);
  }
  return entryCount;
}

function allEditDiffStats(conversation: ConversationViewModel): number {
  let total = 0;
  for (const item of conversation.items) {
    if (item.kind !== 'tool' || item.toolCall.kind !== 'edit') continue;
    const stats = toolCallDiffStats(item.toolCall);
    total += stats.additions + stats.deletions;
  }
  return total;
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function measure(fn: () => void, iterations: number, warmup = 2): number {
  for (let i = 0; i < warmup; i += 1) fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const a = performance.now();
    fn();
    samples.push(performance.now() - a);
  }
  return median(samples);
}

function fmt(ms: number): string {
  if (ms < 1) return (ms * 1000).toFixed(0) + 'µs';
  if (ms < 10) return ms.toFixed(2) + 'ms';
  return ms.toFixed(1) + 'ms';
}

function reportShape(shape: LoadShape): string {
  const conversation = buildConversation(shape);
  const iters = shape.turns >= 80 ? 6 : 30;

  const pipelineOnce = measure(() => {
    conversationViewPipeline(conversation);
  }, iters);

  const pipelineNoEdits = measure(() => {
    conversationViewPipelineNoEdits(conversation);
  }, iters);

  const streamPipeline = measure(
    () => {
      const base = conversation.items.slice(0, -1);
      const last = conversation.items.at(-1);
      if (last?.kind !== 'message') return;
      let text = last.blocks[0]?.type === 'text' ? last.blocks[0].text : '';
      for (let i = 0; i < shape.streamTicks; i += 1) {
        text += ' token' + String(i);
        conversationViewPipeline({
          ...conversation,
          items: [...base, { ...last, blocks: [{ type: 'text', text }], isStreaming: true }],
        });
      }
    },
    shape.turns >= 80 ? 2 : 4,
  );

  const diffs = measure(() => {
    allEditDiffStats(conversation);
  }, iters);

  const turnEdits = measure(() => {
    turnFileEdits(conversation.items);
  }, iters);

  expect(conversationViewPipeline(conversation)).toBeGreaterThan(0);

  return [
    '## ' + shape.label,
    'items: ' + String(conversation.items.length),
    'pipeline once (median):                     ' + fmt(pipelineOnce),
    'pipeline without turnFileEdits (median):    ' + fmt(pipelineNoEdits),
    'pipeline × ' +
      String(shape.streamTicks) +
      ' stream ticks:            ' +
      fmt(streamPipeline) +
      '  (≈ ' +
      fmt(streamPipeline / shape.streamTicks) +
      '/tick)',
    'all edit toolCallDiffStats once:            ' + fmt(diffs),
    'turnFileEdits(whole timeline) once:         ' + fmt(turnEdits),
  ].join('\n');
}

function reportIsolatedDiffs(): string {
  const cases: Array<{ label: string; n: number }> = [
    { label: '200×200 lines', n: 200 },
    { label: '500×500 lines (near LCS cap)', n: 500 },
    { label: '600×600 lines (fallback)', n: 600 },
  ];
  return [
    '## isolated toolCallDiffStats',
    ...cases.map((c) => {
      const tool = {
        content: [
          {
            type: 'diff' as const,
            path: 'f.ts',
            oldText: lines(c.n, 'o:'),
            newText: lines(c.n, 'n:'),
          },
        ],
      };
      const m = measure(() => {
        toolCallDiffStats(tool);
      }, 12);
      return c.label.padEnd(36) + fmt(m);
    }),
  ].join('\n');
}

describe('conversation perf report (ConversationView pipeline)', () => {
  it('prints pure-pipeline and diff-stats timings', () => {
    const body = [...SHAPES.map((shape) => reportShape(shape)), reportIsolatedDiffs()].join('\n\n');
    // eslint-disable-next-line no-console -- intentional profiling report output
    console.log(
      [
        '',
        'LinkCode ConversationView pure pipeline — performance report',
        'Note: pure JS only (no React commit / Streamdown / layout). Each stream tick ≈ one agent.event recompute.',
        '',
        body,
        '',
      ].join('\n'),
    );
  }, 60000);
});
