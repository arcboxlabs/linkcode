// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentOnboardingCard } from '../agent-onboarding-card';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

afterEach(cleanup);

describe('AgentLoginCard awaiting phase per kind (CODE-174)', () => {
  it('claude-code offers the paste-code input', () => {
    render(
      <AgentOnboardingCard
        cue={{ state: 'needs-login', phase: 'awaiting-code', url: 'https://x' }}
        kind="claude-code"
        onSubmitLoginCode={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText('loginCodePlaceholder')).toBeTruthy();
    expect(screen.queryByText('loginAwaitingBrowser')).toBeNull();
  });

  it('codex waits on the browser callback with no code input', () => {
    render(
      <AgentOnboardingCard
        cue={{ state: 'needs-login', phase: 'awaiting-code', url: 'https://x' }}
        kind="codex"
        onCancelLogin={vi.fn()}
        onSubmitLoginCode={vi.fn()}
      />,
    );
    expect(screen.getByText('loginAwaitingBrowser')).toBeTruthy();
    expect(screen.queryByPlaceholderText('loginCodePlaceholder')).toBeNull();
    expect(screen.getByRole('button', { name: 'loginCancel' })).toBeTruthy();
  });
});
