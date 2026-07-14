// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationViewModel } from '../../chat/types';
import type { AgentRuntimeCues } from '../agent-onboarding-card';
import { ConversationSurface } from '../conversation-surface';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

const EMPTY_CONVERSATION: ConversationViewModel = {
  items: [],
  status: 'idle',
  usage: null,
  currentModeId: null,
  approvalPolicy: null,
  currentModel: null,
  currentEffort: null,
  availableCommands: null,
  capabilities: null,
  stopReason: null,
  pendingPermissionIds: [],
  pendingQuestionIds: [],
};

function surface(runtimeCues?: AgentRuntimeCues): React.ReactNode {
  return (
    <ConversationSurface
      conversation={EMPTY_CONVERSATION}
      agentKind="claude-code"
      permissionDecisions={new Map()}
      respondingPermissions={new Set()}
      answeredQuestionIds={new Set()}
      respondingQuestions={new Set()}
      isRunning={false}
      runtimeCues={runtimeCues}
      onLoginAgent={vi.fn()}
      onSendPrompt={vi.fn()}
      onStopTurn={vi.fn()}
      onRespondPermission={vi.fn()}
      onRespondQuestion={vi.fn()}
    />
  );
}

afterEach(cleanup);

describe('ConversationSurface needs-login recovery (CODE-172)', () => {
  it('renders the sign-in card and blocks send for a needs-login cue', () => {
    render(surface({ 'claude-code': { state: 'needs-login', phase: 'idle' } }));
    // The AgentLoginCard idle phase: title + sign-in button (mocked i18n returns raw keys).
    expect(screen.getByText('needsLoginTitle')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'login' })).toBeTruthy();
    // The composer's send button is gated by sendBlocked even with text present.
    const send = screen.getByRole('button', { name: 'send' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it('ignores non-login cues for an already-running session', () => {
    render(surface({ 'claude-code': { state: 'missing', downloadable: true } }));
    expect(screen.queryByText('missingTitle')).toBeNull();
    expect(screen.queryByText('needsLoginTitle')).toBeNull();
  });

  it('renders no card when the agent has no cue', () => {
    render(surface({ codex: { state: 'needs-login', phase: 'idle' } }));
    expect(screen.queryByText('needsLoginTitle')).toBeNull();
  });
});
