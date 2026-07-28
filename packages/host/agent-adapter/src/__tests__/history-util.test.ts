import type { AgentHistoryEvent } from '@linkcode/schema';
import { MAX_ATTACHMENT_TOTAL_BASE64_LENGTH } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { asHistoryId, asMessageId, sliceHistoryEventPage } from '../history-util';

const HID = asHistoryId('history-paging');

function textEvent(id: string): AgentHistoryEvent {
  return {
    historyId: HID,
    itemId: id,
    event: {
      type: 'user-message',
      messageId: asMessageId(id),
      content: [{ type: 'text', text: id }],
    },
  };
}

function imageEvent(id: string, base64Length: number): AgentHistoryEvent {
  return {
    historyId: HID,
    itemId: id,
    event: {
      type: 'user-message',
      messageId: asMessageId(id),
      content: [{ type: 'image', data: 'A'.repeat(base64Length), mimeType: 'image/png' }],
    },
  };
}

function itemIds(page: { events: AgentHistoryEvent[] }): Array<string | undefined> {
  return page.events.map((event) => event.itemId);
}

describe('sliceHistoryEventPage', () => {
  it('passes a small page through whole with no cursor', () => {
    const events = [textEvent('a'), textEvent('b')];
    const page = sliceHistoryEventPage(events, 0, 1000);
    expect(itemIds(page)).toEqual(['a', 'b']);
    expect(page.cursor).toBeUndefined();
  });

  it('still cuts by event count and resumes from the cursor', () => {
    const events = [textEvent('a'), textEvent('b'), textEvent('c')];
    const first = sliceHistoryEventPage(events, 0, 2);
    expect(itemIds(first)).toEqual(['a', 'b']);
    expect(first.cursor).toBe('2');
    const rest = sliceHistoryEventPage(events, 2, 2);
    expect(itemIds(rest)).toEqual(['c']);
    expect(rest.cursor).toBeUndefined();
  });

  it('cuts before the event that would overflow the aggregate attachment budget', () => {
    const large = Math.ceil(MAX_ATTACHMENT_TOTAL_BASE64_LENGTH * 0.6);
    const events = [imageEvent('img-1', large), textEvent('text-1'), imageEvent('img-2', large)];
    const first = sliceHistoryEventPage(events, 0, 1000);
    expect(itemIds(first)).toEqual(['img-1', 'text-1']);
    expect(first.cursor).toBe('2');
    const rest = sliceHistoryEventPage(events, 2, 1000);
    expect(itemIds(rest)).toEqual(['img-2']);
    expect(rest.cursor).toBeUndefined();
  });

  it('always ships the first event of a page even at the full budget', () => {
    const events = [
      imageEvent('img-1', MAX_ATTACHMENT_TOTAL_BASE64_LENGTH),
      imageEvent('img-2', MAX_ATTACHMENT_TOTAL_BASE64_LENGTH),
    ];
    const first = sliceHistoryEventPage(events, 0, 1000);
    expect(itemIds(first)).toEqual(['img-1']);
    expect(first.cursor).toBe('1');
    const rest = sliceHistoryEventPage(events, 1, 1000);
    expect(itemIds(rest)).toEqual(['img-2']);
    expect(rest.cursor).toBeUndefined();
  });

  it('returns an empty page with no cursor for an out-of-range offset', () => {
    const page = sliceHistoryEventPage([textEvent('a')], 5, 1000);
    expect(page.events).toEqual([]);
    expect(page.cursor).toBeUndefined();
  });
});
