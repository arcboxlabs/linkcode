// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineageNotice } from '../lineage-notice';

vi.mock('use-intl', () => ({ useTranslations: () => (key: string) => key }));

afterEach(cleanup);

describe('LineageNotice', () => {
  it('offers the way back from a parked version', () => {
    const onJump = vi.fn();
    render(<LineageNotice notice={{ kind: 'parked', onJump }} />);
    expect(screen.getByText('viewingEarlierVersion')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'dismiss' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'backToLatest' }));
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('lets a parked viewer dismiss or follow a conversation that moved elsewhere', () => {
    const onJump = vi.fn();
    const onDismiss = vi.fn();
    render(<LineageNotice notice={{ kind: 'elsewhere', onJump, onDismiss }} />);
    expect(screen.getByText('continuedElsewhere')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'jumpToLatest' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledTimes(1);
  });
});
