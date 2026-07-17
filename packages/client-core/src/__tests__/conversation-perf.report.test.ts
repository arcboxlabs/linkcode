/**
 * One-shot timing report for the conversation fold path.
 *
 *   pnpm test packages/client-core/src/__tests__/conversation-perf.report.test.ts
 *
 * Always prints a table (not a flaky timing assertion). Pair with the *.bench.ts files
 * for statistical runs via `pnpm exec vitest bench …`.
 */

import type { AgentEvent, MessageId, SessionId } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { LinkCodeClient } from '../client';
import { EventBuffer } from '../client/event-buffer';
import type { Conversation } from '../conversation';
import { createConversationBuilder } from '../conversation';
import { createConversationStore } from '../conversation-store';

interface LoadShape {
  label: string;
  turns: number;
  toolsPerTurn: number;
  editsPerTurn: number;
  editLines: number;
  streamChunks: number;
  chunkChars: number;
}

const SHAPES: LoadShape[] = [
  {
    label: 'small (~20 turns)',
    turns: 20,
    toolsPerTurn: 4,
    editsPerTurn: 1,
    editLines: 40,
    streamChunks: 100,
    chunkChars: 24,
  },
  {
    label: 'large (~80 turns)',
    turns: 80,
    toolsPerTurn: 8,
    editsPerTurn: 2,
    editLines: 120,
    streamChunks: 200,
    chunkChars: 32,
  },
];

function lines(count: number, prefix: string): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) parts.push(prefix + String(i));
  return parts.join('\n') + '\n';
}

function textChunk(messageId: string, text: string): AgentEvent {
  return {
    type: 'agent-message-chunk',
    messageId: messageId as MessageId,
    content: { type: 'text', text },
  };
}

function seedHistory(shape: LoadShape): AgentEvent[] {
  const events: AgentEvent[] = [{ type: 'status', status: 'running' }];
  for (let t = 0; t < shape.turns; t += 1) {
    events.push({
      type: 'user-message',
      content: [{ type: 'text', text: 'Please work on task ' + String(t) }],
    });
    for (let k = 0; k < shape.toolsPerTurn; k += 1) {
      const kind = k % 3 === 0 ? 'read' : k % 3 === 1 ? 'search' : 'execute';
      const id = 't' + String(t) + '-tool-' + String(k);
      events.push({
        type: 'tool-call',
        toolCall: {
          toolCallId: id,
          title: kind + ' ' + id,
          kind,
          status: 'completed',
          content:
            kind === 'search'
              ? [
                  {
                    type: 'content',
                    content: { type: 'text', text: lines(30, 'hit:' + String(t) + ':') },
                  },
                ]
              : [],
        },
      });
    }
    for (let e = 0; e < shape.editsPerTurn; e += 1) {
      const id = 't' + String(t) + '-edit-' + String(e);
      events.push({
        type: 'tool-call',
        toolCall: {
          toolCallId: id,
          title: 'Edit src/' + String(t) + '/' + String(e) + '.ts',
          kind: 'edit',
          status: 'completed',
          content: [
            {
              type: 'diff',
              path: 'src/' + String(t) + '/' + String(e) + '.ts',
              oldText: lines(shape.editLines, 'old' + String(t) + String(e) + ':'),
              newText: lines(shape.editLines, 'new' + String(t) + String(e) + ':'),
            },
          ],
        },
      });
    }
    const messageId = 'asst-' + String(t);
    events.push(textChunk(messageId, 'Summary of turn ' + String(t) + '.\n'));
    events.push(textChunk(messageId, lines(8, 'detail-' + String(t) + '-')));
  }
  return events;
}

function streamTail(shape: LoadShape): AgentEvent[] {
  const messageId = 'asst-streaming';
  const events: AgentEvent[] = [textChunk(messageId, 'Streaming reply:\n')];
  const piece = 'x'.repeat(shape.chunkChars);
  for (let i = 0; i < shape.streamChunks; i += 1) {
    events.push(textChunk(messageId, piece + ' '));
  }
  return events;
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

function foldHistory(history: readonly AgentEvent[]): Conversation {
  const builder = createConversationBuilder();
  for (const event of history) builder.advance(event);
  return builder.snapshot();
}

/** Minimal EventBuffer-backed client surface for createConversationStore. */
function bufferClient(buffer: EventBuffer): LinkCodeClient {
  return {
    eventSeq: (id: SessionId) => buffer.eventSeq(id),
    eventsSnapshot: (id: SessionId) => buffer.snapshot(id),
    subscribe: (id: SessionId, cb: () => void) => buffer.subscribe(id, () => cb()),
  } as LinkCodeClient;
}

function reportShape(shape: LoadShape): string {
  const history = seedHistory(shape);
  const stream = streamTail(shape);
  const folded = foldHistory(history);

  const foldOnce = measure(() => {
    foldHistory(history);
  }, 8);

  const streamFold = measure(() => {
    const builder = createConversationBuilder();
    for (const event of history) builder.advance(event);
    for (const event of stream) {
      builder.advance(event);
      builder.snapshot();
    }
  }, 4);

  const storeStream = measure(() => {
    const sessionId = 'sess-perf' as SessionId;
    const buffer = new EventBuffer();
    for (const event of history) buffer.ingest(sessionId, event);
    const store = createConversationStore(bufferClient(buffer), sessionId);
    store.getSnapshot();
    for (const event of stream) {
      buffer.ingest(sessionId, event);
      store.getSnapshot();
    }
  }, 4);

  expect(folded.items.length).toBeGreaterThan(shape.turns * 2);

  return [
    '## ' + shape.label,
    'seed: ' + String(history.length) + ' events → ' + String(folded.items.length) + ' items',
    'fold history once (median):              ' + fmt(foldOnce),
    'stream ' +
      String(shape.streamChunks) +
      ' chunks + snapshot each:   ' +
      fmt(streamFold) +
      '  (≈ ' +
      fmt(streamFold / shape.streamChunks) +
      '/chunk)',
    'store stream ' +
      String(shape.streamChunks) +
      ' chunks:            ' +
      fmt(storeStream) +
      '  (≈ ' +
      fmt(storeStream / shape.streamChunks) +
      '/chunk)',
  ].join('\n');
}

describe('conversation perf report (fold / store)', () => {
  it('prints fold-path timings for small and large synthetic sessions', () => {
    const body = SHAPES.map((shape) => reportShape(shape)).join('\n\n');
    // eslint-disable-next-line no-console -- intentional profiling report output
    console.log(['', 'LinkCode conversation fold — performance report', '', body, ''].join('\n'));
  });
});
