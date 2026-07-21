// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThoughtBlock } from '../thought-block';

function translate(key: string, values?: Record<string, unknown>): string {
  if (key === 'thinking') return 'Thinking…';
  if (key === 'thought') return 'Thought';
  if (key === 'thoughtDuration') return `Thought for ${String(values?.seconds)} seconds`;
  return key;
}

vi.mock('use-intl', () => ({ useTranslations: () => translate }));

afterEach(cleanup);

describe('ThoughtBlock', () => {
  it('shows only the observed duration after settlement and reveals content on demand', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ThoughtBlock
        blocks={[{ type: 'text', text: 'Private chain of thought' }]}
        endedAt={6300}
        startedAt={1000}
      />,
    );

    const trigger = screen.getByRole('button');
    expect(trigger.textContent).toBe('Thought for 5 seconds');
    expect(trigger.textContent).not.toContain('Private chain of thought');
    expect(trigger.querySelector('svg.lucide-sparkles')).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Private chain of thought')).toBeDefined();
    const scrollArea = container.querySelector('[data-slot="chat-disclosure-scroll"]');
    const viewport = scrollArea?.querySelector('[data-slot="scroll-area-viewport"]');
    expect(scrollArea?.className).toContain('max-h-96');
    expect(scrollArea?.className).toContain('**:data-[slot=scroll-area-viewport]:max-h-96');
    expect(viewport?.className).toContain('mask-t-from');
    expect(viewport?.className).toContain('mask-b-from');
  });

  it.each([
    ['missing start', undefined, 2000],
    ['missing end', 1000, undefined],
    ['invalid interval', 2000, 1000],
  ] as const)('falls back to Thought for %s', (_label, startedAt, endedAt) => {
    render(
      <ThoughtBlock
        blocks={[{ type: 'text', text: 'Never preview this' }]}
        endedAt={endedAt}
        startedAt={startedAt}
      />,
    );

    expect(screen.getByRole('button').textContent).toBe('Thought');
  });

  it('shows only an explicit normalized public summary while streaming', () => {
    render(
      <ThoughtBlock
        blocks={[{ type: 'text', text: 'api_key=private' }]}
        isStreaming
        summary={'  Reviewing\n  the public API  '}
      />,
    );

    const trigger = screen.getByRole('button');
    expect(trigger.textContent).toBe('Thinking…Reviewing the public API');
    expect(trigger.textContent).not.toContain('api_key');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
});
