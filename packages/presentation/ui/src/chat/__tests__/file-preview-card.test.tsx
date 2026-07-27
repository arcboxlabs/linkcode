// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { nullthrow } from 'foxact/nullthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewCard } from '../file-preview-card';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({ useTranslations: () => translateKey }));

/** jsdom lays nothing out, so both metrics read 0 and the card can never look overflowing.
 * Stub the pair the overflow check reads to drive each branch deterministically. */
function stubPanelMetrics(scrollHeight: number, clientHeight: number): void {
  for (const [name, value] of [
    ['scrollHeight', scrollHeight],
    ['clientHeight', clientHeight],
  ] as const) {
    vi.spyOn(HTMLElement.prototype, name, 'get').mockReturnValue(value);
  }
}

const PEEK = 'chat-card-peek';
const FADE = 'chat-card-peek-fade';

function panelOf(container: HTMLElement): HTMLElement {
  return nullthrow(
    container.querySelector<HTMLElement>('[data-slot="frame-panel"]'),
    'no panel rendered',
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FilePreviewCard peek', () => {
  it('offers a toggle only when the body outgrows the peek', () => {
    stubPanelMetrics(600, 200);
    const { container } = render(<FilePreviewCard path="/repo/a.ts">body</FilePreviewCard>);

    expect(panelOf(container).className).toContain(PEEK);
    expect(panelOf(container).className).toContain(FADE);
    expect(screen.getByRole('button', { name: 'expand' })).toBeDefined();
  });

  it('leaves a body that already fits unclamped and uncontrolled', () => {
    stubPanelMetrics(120, 120);
    const { container } = render(<FilePreviewCard path="/repo/a.ts">body</FilePreviewCard>);

    // The clamp class stays — it is what caps the peek — but nothing is hidden behind it, so the
    // card offers no affordance and must NOT fade: the gradient is relative to the element's own
    // height, so an unconditional mask greys out the last line of a fully-visible body.
    expect(panelOf(container).className).toContain(PEEK);
    expect(panelOf(container).className).not.toContain(FADE);
    expect(container.querySelector('footer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'expand' })).toBeNull();
  });

  it('drops the clamp when expanded and keeps the control to collapse again', async () => {
    stubPanelMetrics(600, 200);
    const { container } = render(<FilePreviewCard path="/repo/a.ts">body</FilePreviewCard>);

    await userEvent.click(screen.getByRole('button', { name: 'expand' }));

    expect(panelOf(container).className).not.toContain(PEEK);
    expect(panelOf(container).className).not.toContain(FADE);
    // Expanding makes the panel fit its content, so the toggle must survive its own success.
    expect(screen.getByRole('button', { name: 'collapse' })).toBeDefined();
  });

  it('renders no body chrome at all when the card has no children', () => {
    stubPanelMetrics(600, 200);
    const { container } = render(<FilePreviewCard path="/repo/a.ts" />);

    expect(container.querySelector('[data-slot="frame-panel"]')).toBeNull();
    expect(container.querySelector('footer')).toBeNull();
  });
});
