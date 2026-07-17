// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompactionMarker } from '../compaction-marker';

vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

afterEach(cleanup);

describe('CompactionMarker', () => {
  it('renders the live compacting row while in progress, with no divider state', () => {
    render(<CompactionMarker inProgress preTokens={1000} postTokens={20} />);
    expect(screen.getByText('compacting')).toBeTruthy();
    expect(screen.queryByText('compacted')).toBeNull();
    expect(screen.queryByText('compactedTokens')).toBeNull();
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
