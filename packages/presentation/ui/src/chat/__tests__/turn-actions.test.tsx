// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentTurnActions } from '../turn-actions';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useFormatter: () => ({ dateTime: () => '' }),
  useTranslations: () => translateKey,
}));

afterEach(cleanup);

describe('AgentTurnActions fork action', () => {
  it('forks through the turn when the runtime offers it', () => {
    const onFork = vi.fn();
    render(<AgentTurnActions copyText="reply" onFork={onFork} />);

    const button = screen.getByRole('button', { name: 'forkFromHere' });
    expect(button).toHaveProperty('disabled', false);
    fireEvent.click(button);
    expect(onFork).toHaveBeenCalledTimes(1);
  });

  it('stays disabled when the host or harness cannot fork sessions', () => {
    render(<AgentTurnActions copyText="reply" />);

    expect(screen.getByRole('button', { name: 'forkFromHere' })).toHaveProperty('disabled', true);
  });
});
