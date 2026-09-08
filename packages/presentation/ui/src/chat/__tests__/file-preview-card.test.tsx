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
  const metrics = [
    ['scrollHeight', scrollHeight],
    ['clientHeight', clientHeight],
  ] as const;
  for (let i = 0, len = metrics.length; i < len; i++) {
    const [name, value] = metrics[i];
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

  it('measures a body that mounts after the header-only first render', () => {
    // The live shape for a Read or an Edit: the announce renders a header-only card and the body
    // only arrives with the settle. The panel element therefore does not exist on the first
    // render, so the size subscription has to attach when it appears rather than once at mount.
    stubPanelMetrics(600, 200);
    const { container, rerender } = render(<FilePreviewCard path="/repo/a.ts" />);
    expect(container.querySelector('[data-slot="frame-panel"]')).toBeNull();

    rerender(<FilePreviewCard path="/repo/a.ts">body</FilePreviewCard>);

    expect(panelOf(container).className).toContain(PEEK);
    expect(panelOf(container).className).toContain(FADE);
    expect(screen.getByRole('button', { name: 'expand' })).toBeDefined();
  });

  it('reveals the body when focus reaches a control clipped behind the peek', async () => {
    // `overflow: clip` hides the overflow visually but keeps its links and checkboxes tabbable,
    // and cannot be scrolled to bring them into view. Expanding on focus is what keeps a
    // keyboard user from landing on something invisible.
    stubPanelMetrics(600, 200);
    const { container } = render(
      <FilePreviewCard path="/repo/a.ts">
        <a href="https://example.test">clipped link</a>
      </FilePreviewCard>,
    );
    expect(panelOf(container).className).toContain(PEEK);

    await userEvent.tab();
    await userEvent.tab();

    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'clipped link' }));
    expect(panelOf(container).className).not.toContain(PEEK);
  });

  it('does not arm focus-expansion on a body that fits', async () => {
    stubPanelMetrics(120, 120);
    const { container } = render(
      <FilePreviewCard path="/repo/a.ts">
        <a href="https://example.test">visible link</a>
      </FilePreviewCard>,
    );

    await userEvent.tab();
    await userEvent.tab();

    // Nothing was hidden, so focusing inside must not sprout a collapse control.
    expect(panelOf(container).className).toContain(PEEK);
    expect(container.querySelector('footer')).toBeNull();
  });
});
