// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PermissionConversationItem } from '../../chat/conversation-prompts';
import type { ConversationViewModel } from '../../chat/types';
import type { AgentRuntimeCues } from '../agent-onboarding-card';
import { ConversationSurface } from '../conversation-surface';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

vi.mock('../../chat/conversation-view', () => ({
  ConversationView: () => null,
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
  availableModels: null,
  capabilities: null,
  stopReason: null,
  pendingPermissionIds: [],
  pendingQuestionIds: [],
};

const PERMISSION_ITEM: PermissionConversationItem = {
  kind: 'approval',
  id: 'permission-1',
  turnId: 'turn-1',
  requestId: 'permission-1',
  toolCall: { toolCallId: 'command-1', title: 'Run command' },
  options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
  responding: false,
};

function surface(
  runtimeCues?: AgentRuntimeCues,
  conversation: ConversationViewModel = EMPTY_CONVERSATION,
): React.ReactNode {
  return (
    <ConversationSurface
      conversation={conversation}
      agentKind="claude-code"
      respondingRequestIds={new Set()}
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

describe('ConversationSurface prompt card', () => {
  it('hides the composer while a prompt card is visible and preserves its draft', async () => {
    const user = userEvent.setup();
    const pendingConversation: ConversationViewModel = {
      ...EMPTY_CONVERSATION,
      items: [PERMISSION_ITEM],
      status: 'running',
      pendingPermissionIds: [PERMISSION_ITEM.requestId],
    };
    const { rerender } = render(surface());

    await user.type(screen.getByRole('textbox'), 'Keep this draft');
    rerender(surface(undefined, pendingConversation));

    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();

    rerender(surface());
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('Keep this draft');
  });
});

describe('ConversationSurface needs-login recovery (CODE-172)', () => {
  it('renders the sign-in card and blocks send for a needs-login cue', async () => {
    const user = userEvent.setup();
    render(surface({ 'claude-code': { state: 'needs-login', phase: 'idle' } }));
    // The AgentLoginCard idle phase: title + sign-in button (mocked i18n returns raw keys).
    expect(screen.getByText('needsLoginTitle')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'login' })).toBeTruthy();
    // Send stays gated by sendBlocked even once text is present (an empty composer disables the
    // button on its own, which would mask a missing sendBlocked wiring).
    await user.type(screen.getByRole('textbox'), 'hello');
    const send = screen.getByRole('button', { name: 'send' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it('leaves send enabled when there is no cue', async () => {
    const user = userEvent.setup();
    render(surface());
    await user.type(screen.getByRole('textbox'), 'hello');
    const send = screen.getByRole('button', { name: 'send' });
    expect((send as HTMLButtonElement).disabled).toBe(false);
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
