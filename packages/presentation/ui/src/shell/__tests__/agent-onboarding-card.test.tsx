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

describe('Providers settings handoff', () => {
  it('shows only Go to settings for the idle signed-out flow and reports the agent', () => {
    const onOpenProviderSettings = vi.fn();
    render(
      <AgentOnboardingCard
        cue={{ state: 'needs-login', phase: 'idle' }}
        kind="claude-code"
        onLogin={vi.fn()}
        onOpenProviderSettings={onOpenProviderSettings}
      />,
    );
    const button = screen.getByRole('button', { name: 'goToSettings' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    button.click();
    expect(onOpenProviderSettings).toHaveBeenCalledWith('claude-code');
  });

  it('replaces retry with Go to settings after a failed workbench login', () => {
    render(
      <AgentOnboardingCard
        cue={{ state: 'needs-login', phase: 'failed', error: 'nope' }}
        kind="codex"
        onLogin={vi.fn()}
        onOpenProviderSettings={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'goToSettings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'retry' })).toBeNull();
  });

  it('keeps direct subscription login available inside settings', () => {
    render(
      <AgentOnboardingCard
        cue={{ state: 'needs-login', phase: 'idle' }}
        kind="codex"
        onLogin={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'login' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'goToSettings' })).toBeNull();
  });
});
