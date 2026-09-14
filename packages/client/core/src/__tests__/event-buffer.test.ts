import type { AgentEvent, SessionId } from '@linkcode/schema';
import { MessageIdSchema } from '@linkcode/schema';
import { describe, expect, it, vi } from 'vitest';
import { EventBuffer } from '../client/event-buffer';

const SESSION_ID = 'session-1' as SessionId;
const RESOLUTION: AgentEvent = {
  type: 'permission-resolved',
  requestId: 'permission-1',
  outcome: { outcome: 'cancelled' },
  source: 'user',
};

describe('EventBuffer', () => {
  it('does not retain or notify duplicate terminal prompt outcomes replayed on attach', () => {
    const buffer = new EventBuffer();
    const listener = vi.fn();
    buffer.subscribe(SESSION_ID, listener);

    buffer.ingest(SESSION_ID, RESOLUTION);
    buffer.ingest(SESSION_ID, RESOLUTION);

    expect(buffer.eventSeq(SESSION_ID)).toBe(2);
    expect(buffer.snapshot(SESSION_ID).map(({ event }) => event)).toEqual([RESOLUTION]);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('retains a stamped repeat so the daemon sequence stays contiguous', () => {
    const buffer = new EventBuffer();

    buffer.ingest(SESSION_ID, RESOLUTION, { epoch: 1, seq: 1 });
    buffer.ingest(SESSION_ID, RESOLUTION, { epoch: 1, seq: 2 });

    // Each stamped frame is a distinct daemon position; dropping one would read as a gap.
    expect(buffer.snapshot(SESSION_ID).map(({ position }) => position)).toEqual([
      { epoch: 1, seq: 1 },
      { epoch: 1, seq: 2 },
    ]);
  });

  it('drops the buffered suffix at a conversation rewind without dropping subscribers', () => {
    const buffer = new EventBuffer();
    const listener = vi.fn();
    buffer.subscribe(SESSION_ID, listener);
    const source: AgentEvent = {
      type: 'user-message',
      messageId: MessageIdSchema.parse('source'),
      content: [{ type: 'text', text: 'old prompt' }],
    };
    const rewind: AgentEvent = {
      type: 'conversation-rewind',
      messageId: MessageIdSchema.parse('source'),
    };
    const replacement: AgentEvent = {
      type: 'user-message',
      messageId: MessageIdSchema.parse('replacement'),
      content: [{ type: 'text', text: 'new prompt' }],
    };

    buffer.ingest(SESSION_ID, source);
    buffer.ingest(SESSION_ID, { type: 'status', status: 'idle' });
    buffer.ingest(SESSION_ID, rewind);
    buffer.ingest(SESSION_ID, replacement);

    expect(buffer.eventSeq(SESSION_ID)).toBe(4);
    expect(buffer.snapshot(SESSION_ID).map(({ event }) => event)).toEqual([rewind, replacement]);
    expect(listener).toHaveBeenCalledTimes(4);
  });
});
