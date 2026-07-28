// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompactionMarker } from '../compaction-marker';
import { formatElapsed } from '../use-elapsed';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

const RE_ELAPSED_SECONDS = /·\s*\d+s/;

afterEach(cleanup);

describe('CompactionMarker', () => {
  it('renders the live compacting row while in progress, with no divider state', () => {
    render(<CompactionMarker inProgress preTokens={1000} postTokens={20} />);
    expect(screen.getByText('compacting')).toBeTruthy();
    expect(screen.getByLabelText('Loading')).toBeTruthy(); // animated spinner, not the static icon
    expect(screen.queryByText('compacted')).toBeNull();
    expect(screen.queryByText('compactedTokens')).toBeNull();
  });

  it('shows a live elapsed counter when a start time is known', () => {
    render(<CompactionMarker inProgress startedAt={Date.now() - 3000} />);
    expect(screen.getByText(RE_ELAPSED_SECONDS)).toBeTruthy();
  });

  it('renders the divider with token detail once completed', () => {
    render(<CompactionMarker preTokens={1000} postTokens={20} />);
    expect(screen.getByText('compacted')).toBeTruthy();
    expect(screen.getByText('compactedTokens')).toBeTruthy();
    expect(screen.queryByText('compacting')).toBeNull();
  });

  it('expands the summary when present', async () => {
    const user = userEvent.setup();
    render(<CompactionMarker summary="what happened so far" />);
    expect(screen.queryByText('what happened so far')).toBeNull();
    await user.click(screen.getByText('compacted'));
    expect(screen.getByText('what happened so far')).toBeTruthy();
  });
});

describe('formatElapsed', () => {
  it('formats seconds, minutes, and hours like codex fmt_elapsed_compact', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(999)).toBe('0s');
    expect(formatElapsed(59000)).toBe('59s');
    expect(formatElapsed(60000)).toBe('1m 00s');
    expect(formatElapsed(61000)).toBe('1m 01s');
    expect(formatElapsed((59 * 60 + 59) * 1000)).toBe('59m 59s');
    expect(formatElapsed(3_600_000)).toBe('1h 00m 00s');
    expect(formatElapsed((3600 + 60 + 1) * 1000)).toBe('1h 01m 01s');
  });

  it('clamps negatives to 0s', () => {
    expect(formatElapsed(-5000)).toBe('0s');
  });
});
