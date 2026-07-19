import type { AgentEvent, SessionId } from '@linkcode/schema';
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
});
