// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Commit } from '../commit';
import { QueueSection, QueueSectionContent, QueueSectionTrigger } from '../queue';
import { StackTrace } from '../stack-trace';

const RE_COMMIT_MESSAGE = /Keep the disclosure chevron with the commit content/;

afterEach(cleanup);

describe('chat disclosure headers', () => {
  it('keeps fixed chrome around a truncatable title and honors the disabled state', async () => {
    const user = userEvent.setup();
    const label = 'A queue title that can exceed the available width';

    render(
      <QueueSection defaultOpen={false} disabled>
        <QueueSectionTrigger count={3} label={label} />
        <QueueSectionContent>Hidden queue content</QueueSectionContent>
      </QueueSection>,
    );

    const trigger = screen.getByRole('button', { name: new RegExp(label) });
    const icon = trigger.querySelector('[data-slot="chat-disclosure-icon"]');
    const chevron = trigger.querySelector('[data-slot="chat-disclosure-chevron"]');
    const title = screen.getByText(label);

    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.className).toContain('focus-visible:ring-2');
    expect(trigger.className).toContain('aria-disabled:opacity-64');
    expect(icon?.className).toContain('shrink-0');
    expect(title.className).toContain('shrink-0');
    expect(title.className).toContain('truncate');
    expect(title.className).toContain('opacity-80');
    expect(chevron?.getAttribute('class')).toContain('shrink-0');
    expect(trigger.lastElementChild).toBe(chevron);

    await user.click(trigger);
    expect(screen.queryByText('Hidden queue content')).toBeNull();
  });

  it('shrinks summaries before titles and keeps the chevron adjacent to content', () => {
    render(
      <>
        <StackTrace
          stackTrace={{
            id: 'trace-1',
            title: 'Build failed',
            trace:
              'TypeError: Something exceeded the available width\n    at build (/repo/build.ts:1:2)',
          }}
        />
        <Commit
          commit={{
            id: 'commit-1',
            hash: '1234567890abcdef',
            message: 'Keep the disclosure chevron with the commit content',
          }}
        />
      </>,
    );

    const stackTitle = screen.getByText('Build failed');
    const stackSummary = screen.getByText(': Something exceeded the available width');
    const stackTrigger = stackTitle.closest('button');
    const stackChevron = stackTrigger?.querySelector('[data-slot="chat-disclosure-chevron"]');

    expect(stackTitle.className).toContain('shrink-0');
    expect(stackTitle.className).toContain('opacity-100');
    expect(stackSummary.className).toContain('shrink');
    expect(stackSummary.className).toContain('truncate');
    expect(stackTrigger?.lastElementChild).toBe(stackChevron);

    const commitTrigger = screen.getByRole('button', {
      name: RE_COMMIT_MESSAGE,
    });
    const commitChevron = commitTrigger.querySelector('[data-slot="chat-disclosure-chevron"]');
    expect(screen.getByText(RE_COMMIT_MESSAGE).className).toContain('opacity-80');
    expect(commitTrigger.lastElementChild).toBe(commitChevron);
  });
});
