/**
 * Microbenchmarks for the conversation fold path — run with:
 *   pnpm exec vitest bench packages/client/core/src/__tests__/conversation-perf.bench.ts
 *
 * Scenarios mirror a mid/long agent session: multi-turn history, then high-frequency
 * agent-message-chunk streaming on top of an already-large timeline.
 */
import type { AgentEvent, MessageId, SessionId } from '@linkcode/schema';
import { bench, describe } from 'vitest';
import type { LinkCodeClient } from '../client';
import { EventBuffer } from '../client/event-buffer';
import { createConversationBuilder } from '../conversation';
import { createConversationStore } from '../conversation-store';

interface LoadShape {
  turns: number;
  toolsPerTurn: number;
  /** Completed edit tools per turn (drive turnFileEdits / toolCallDiffStats downstream). */
  editsPerTurn: number;
  editLines: number;
  /** Stream chunks to append after the seeded history (last assistant message). */
  streamChunks: number;
  chunkChars: number;
}

const SMALL: LoadShape = {
  turns: 20,
  toolsPerTurn: 4,
  editsPerTurn: 1,
  editLines: 40,
  streamChunks: 100,
  chunkChars: 24,
};

const LARGE: LoadShape = {
  turns: 80,
  toolsPerTurn: 8,
  editsPerTurn: 2,
  editLines: 120,
  streamChunks: 200,
  chunkChars: 32,
};

function lines(count: number, prefix: string): string {
  let out = '';
  for (let i = 0; i < count; i += 1) out += `${prefix}${i}\n`;
  return out;
}

function textChunk(messageId: string, text: string): AgentEvent {
  return {
    type: 'agent-message-chunk',
    messageId: messageId as MessageId,
    content: { type: 'text', text },
  };
}

/** Synthetic multi-turn transcript: user → tools (read/search/edit) → assistant reply. */
function seedHistory(shape: LoadShape): AgentEvent[] {
  const events: AgentEvent[] = [{ type: 'status', status: 'running' }];
  for (let t = 0; t < shape.turns; t += 1) {
    events.push({
      type: 'user-message',
      content: [{ type: 'text', text: `Please work on task ${t}` }],
    });
    for (let k = 0; k < shape.toolsPerTurn; k += 1) {
      const kind = k % 3 === 0 ? 'read' : k % 3 === 1 ? 'search' : 'execute';
      const id = `t${t}-tool-${k}`;
      events.push({
        type: 'tool-call',
        toolCall: {
          toolCallId: id,
          title: `${kind} ${id}`,
          kind,
          status: 'completed',
          content:
            kind === 'search'
              ? [
                  {
                    type: 'content',
                    content: {
                      type: 'text',
                      text: lines(30, `hit:${t}:${k}:`),
                    },
                  },
                ]
              : kind === 'execute'
                ? [{ type: 'terminal', terminalId: `term-${t}-${k}` }]
                : [
                    {
                      type: 'content',
                      content: { type: 'text', text: lines(20, `file:${t}:${k}:`) },
                    },
                  ],
        },
      });
    }
    for (let e = 0; e < shape.editsPerTurn; e += 1) {
      const id = `t${t}-edit-${e}`;
      const oldText = lines(shape.editLines, `old${t}${e}:`);
      const newText = lines(shape.editLines, `new${t}${e}:`);
      events.push({
        type: 'tool-call',
        toolCall: {
          toolCallId: id,
          title: `Edit src/${t}/${e}.ts`,
          kind: 'edit',
          status: 'completed',
          content: [{ type: 'diff', path: `src/${t}/${e}.ts`, oldText, newText }],
          locations: [{ path: `src/${t}/${e}.ts` }],
        },
      });
    }
    const messageId = `asst-${t}`;
    events.push(textChunk(messageId, `Summary of turn ${t}.\n`));
    events.push(textChunk(messageId, lines(8, `detail-${t}-`)));
  }
  return events;
}

function streamTail(shape: LoadShape): AgentEvent[] {
  const messageId = 'asst-streaming';
  const events: AgentEvent[] = [textChunk(messageId, 'Streaming reply:\n')];
  const piece = 'x'.repeat(shape.chunkChars);
  for (let i = 0; i < shape.streamChunks; i += 1) {
    events.push(textChunk(messageId, `${piece} `));
  }
  return events;
}

function foldAll(events: readonly AgentEvent[]): void {
  const builder = createConversationBuilder();
  for (const event of events) builder.advance(event);
  builder.snapshot();
}

function foldStreamingCost(shape: LoadShape): void {
  const history = seedHistory(shape);
  const builder = createConversationBuilder();
  for (const event of history) builder.advance(event);
  for (const event of streamTail(shape)) {
    builder.advance(event);
    // Each live chunk invalidates the cache and forces a fresh items shallow-copy.
    builder.snapshot();
  }
}

function bufferClient(buffer: EventBuffer): LinkCodeClient {
  return {
    eventSeq: (id: SessionId) => buffer.eventSeq(id),
    eventsSnapshot: (id: SessionId) => buffer.snapshot(id),
    subscribe: (id: SessionId, cb: () => void) => buffer.subscribe(id, () => cb()),
  } as LinkCodeClient;
}

function storeStreamingCost(shape: LoadShape): void {
  const sessionId = 'sess-perf' as SessionId;
  const history = seedHistory(shape);
  const buffer = new EventBuffer();
  for (const event of history) buffer.ingest(sessionId, event);

  // createConversationStore only needs the event surface used by sync().
  const store = createConversationStore(bufferClient(buffer), sessionId);
  // Seed fold via first getSnapshot.
  store.getSnapshot();

  for (const event of streamTail(shape)) {
    buffer.ingest(sessionId, event);
    store.getSnapshot();
  }
}

function eventBufferSnapshotCost(shape: LoadShape): void {
  const sessionId = 'sess-buf' as SessionId;
  const buffer = new EventBuffer();
  for (const event of seedHistory(shape)) buffer.ingest(sessionId, event);
  for (const event of streamTail(shape)) buffer.ingest(sessionId, event);
  // snapshot copies the full buffer array when the cache is cold; force cold each time.
  buffer.ingest(sessionId, textChunk('force', '.'));
  buffer.snapshot(sessionId);
}

describe('conversation fold — small (~20 turns)', () => {
  const history = seedHistory(SMALL);
  bench('fold history once', () => {
    foldAll(history);
  });
  bench('stream 100 chunks + snapshot each (on seeded history)', () => {
    foldStreamingCost(SMALL);
  });
  bench('store stream 100 chunks (EventBuffer + ConversationStore)', () => {
    storeStreamingCost(SMALL);
  });
});

describe('conversation fold — large (~80 turns)', () => {
  const history = seedHistory(LARGE);
  bench('fold history once', () => {
    foldAll(history);
  });
  bench('stream 200 chunks + snapshot each (on seeded history)', () => {
    foldStreamingCost(LARGE);
  });
  bench('store stream 200 chunks (EventBuffer + ConversationStore)', () => {
    storeStreamingCost(LARGE);
  });
  bench('EventBuffer cold snapshot after full load', () => {
    eventBufferSnapshotCost(LARGE);
  });
});
