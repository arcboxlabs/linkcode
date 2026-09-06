// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { asyncNoop } from 'foxts/noop';
import { useEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  AttachmentPreviewProvider,
  resetAttachmentPreviews,
  useAttachmentPreview,
} from '../attachment-preview';

afterEach(() => {
  cleanup();
  resetAttachmentPreviews();
  vi.useRealTimers();
});

function Probe({ id, seen }: { id: string; seen: (url: string | undefined) => void }) {
  const preview = useAttachmentPreview(id);
  seen(preview?.url);
  return null;
}

/** The workbench resets the preview store on switch from an effect cleanup keyed to the session. */
function Surface({ sessionId, seen }: { sessionId: string; seen: (url?: string) => void }) {
  useEffect(() => () => resetAttachmentPreviews(), [sessionId]);
  return <Probe id={`att-${sessionId}`} seen={seen} />;
}

it('resolves a session’s previews once across a switch that resets the store', async () => {
  const resolve = vi.fn((id: string) => Promise.resolve({ url: `blob:${id}` }));
  const seen = vi.fn();
  const view = render(
    <AttachmentPreviewProvider resolve={resolve}>
      <Surface sessionId="a" seen={seen} />
    </AttachmentPreviewProvider>,
  );
  await act(asyncNoop);
  view.rerender(
    <AttachmentPreviewProvider resolve={resolve}>
      <Surface sessionId="b" seen={seen} />
    </AttachmentPreviewProvider>,
  );
  await act(asyncNoop);

  expect(resolve.mock.calls.filter(([id]) => id === 'att-b')).toHaveLength(1);
  expect(seen).toHaveBeenLastCalledWith('blob:att-b');
});

it('stops retrying a failing preview after bounded backoff and caches the miss', async () => {
  vi.useFakeTimers();
  const resolve = vi.fn(() => Promise.reject(new Error('store I/O')));
  const seen = vi.fn();
  render(
    <AttachmentPreviewProvider resolve={resolve}>
      <Probe id="att-1" seen={seen} />
    </AttachmentPreviewProvider>,
  );
  for (let i = 0; i < 12; i++) {
    // eslint-disable-next-line no-await-in-loop -- each tick drains one retry timer
    await act(() => vi.advanceTimersByTimeAsync(60 * 1000));
  }
  expect(resolve).toHaveBeenCalledTimes(5);
  expect(seen).toHaveBeenLastCalledWith(undefined);
});
