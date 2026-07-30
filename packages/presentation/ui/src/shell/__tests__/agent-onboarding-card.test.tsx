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

describe('API-key alternative to the OAuth login', () => {
  it('offers it next to the sign-in button and reports the agent', () => {
    const onUseApiKey = vi.fn();
    render(
      <AgentOnboardingCard
        cue={{ state: 'needs-login', phase: 'idle' }}
        kind="claude-code"
        onLogin={vi.fn()}
        onUseApiKey={onUseApiKey}
      />,
    );
    screen.getByRole('button', { name: 'loginWithApiKey' }).click();
    expect(onUseApiKey).toHaveBeenCalledWith('claude-code');
  });

  it('offers it as the recovery after a failed login', () => {
    render(
      <AgentOnboardingCard
        cue={{ state: 'needs-login', phase: 'failed', error: 'nope' }}
        kind="codex"
        onLogin={vi.fn()}
        onUseApiKey={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'loginWithApiKey' })).toBeTruthy();
  });

  it('stays hidden when the host provides no handler', () => {
    render(
      <AgentOnboardingCard
        cue={{ state: 'needs-login', phase: 'idle' }}
        kind="codex"
        onLogin={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'loginWithApiKey' })).toBeNull();
  });
});
