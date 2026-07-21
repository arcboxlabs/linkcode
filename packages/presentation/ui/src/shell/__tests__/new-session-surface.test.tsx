// @vitest-environment jsdom

import { WorkspaceIdSchema } from '@linkcode/schema';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NewSessionSurface } from '../new-session-surface';
import {
  composerText,
  pressInComposer,
  setupComposerTestDOM,
  typeInComposer,
} from './composer-test-utils';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

beforeAll(setupComposerTestDOM);
afterEach(cleanup);

const CHAT_WORKSPACE = {
  workspaceId: WorkspaceIdSchema.parse('workspace-1'),
  cwd: '/chat',
  kind: 'chat' as const,
  createdAt: 1,
  lastUsedAt: 1,
};
const RE_MODEL_DEFAULT = /modelDefault/;
const RE_SONNET_5 = /Sonnet 5/;
const RE_CONFIGURED_CLAUDE_MODEL = /configured\/claude-model/;
const RE_OPUS_4_8 = /Opus 4.8/;
const RE_MEDIUM_EFFORT = /Medium/;
const RE_CUSTOM_CLAUDE_MODEL = /custom\/claude-model/;
const RE_DYNAMIC_CLAUDE_MODEL = /anthropic\/claude-sonnet-4-6/;

describe('NewSessionSurface', () => {
  it.each([
    'claude-code',
    'codex',
    'opencode',
  ] as const)('submits a leading slash command for %s', async (provider) => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        draft={{
          initialProvider: provider,
          initialWorkspaceId: CHAT_WORKSPACE.workspaceId,
        }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    typeInComposer('/compact');
    await pressInComposer('Enter');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
        kind: provider,
        cwd: '/chat',
        workspaceId: CHAT_WORKSPACE.workspaceId,
        model: undefined,
        modeId: undefined,
        input: { type: 'command', name: 'compact' },
      }),
    );
  });

  it.each([
    'opencode',
    'pi',
  ] as const)('keeps the default model label visible for dynamic provider %s', (provider) => {
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        draft={{ initialProvider: provider, initialWorkspaceId: CHAT_WORKSPACE.workspaceId }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        workspaces={[]}
      />,
    );

    expect(screen.getByRole('button', { name: RE_MODEL_DEFAULT })).toBeTruthy();
  });

  it('names the model selector with its agent, model, and reasoning effort', () => {
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        draft={{ initialProvider: 'claude-code', initialWorkspaceId: CHAT_WORKSPACE.workspaceId }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        workspaces={[]}
      />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Claude Code, Sonnet 5, reasoning: effortDefault',
      }),
    ).toBeTruthy();
  });

  it.each([
    'codex',
    'opencode',
  ] as const)('submits a leading shell command for %s', async (provider) => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        draft={{ initialProvider: provider, initialWorkspaceId: CHAT_WORKSPACE.workspaceId }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    typeInComposer('$ pwd');
    await pressInComposer('Enter');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ input: { type: 'shell-command', command: 'pwd' } }),
      ),
    );
  });

  it.each([
    {
      draft: '/compact ',
      input: { type: 'command', name: 'compact' } as const,
      label: 'slash command',
    },
    {
      draft: '$ pwd',
      input: { type: 'shell-command', command: 'pwd' } as const,
      label: 'shell command',
    },
  ])('blocks a $label until staged attachments are removed', async ({ draft, input }) => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        attachmentSupport={{ codex: true }}
        chatWorkspace={CHAT_WORKSPACE}
        draft={{ initialProvider: 'codex', initialWorkspaceId: CHAT_WORKSPACE.workspaceId }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    fireEvent.paste(screen.getByRole('combobox'), {
      clipboardData: {
        files: [new File([Uint8Array.from([137, 80, 78, 71])], 'probe.png', { type: 'image/png' })],
      },
    });
    await screen.findByRole('img', { name: 'probe.png' });

    typeInComposer(draft);
    expect(await screen.findByText('directiveAttachmentsConflict')).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(true);

    await pressInComposer('Enter');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'removeAttachment' }));
    await waitFor(() => expect(screen.queryByText('directiveAttachmentsConflict')).toBeNull());
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(false);

    await pressInComposer('Enter');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ input })));
  });

  it.each([
    { draft: 'keep this prompt', inputType: 'prompt', label: 'prompt', withAttachment: true },
    { draft: '/compact ', inputType: 'command', label: 'slash command', withAttachment: false },
    { draft: '$ pwd', inputType: 'shell-command', label: 'shell command', withAttachment: false },
  ] as const)('retains a rejected first-turn $label and guards duplicate submission', async ({
    draft,
    inputType,
    withAttachment,
  }) => {
    let rejectSubmission!: (reason?: unknown) => void;
    const pendingSubmission = new Promise<void>((_resolve, reject) => {
      rejectSubmission = reject;
    });
    const onSubmit = vi.fn().mockReturnValue(pendingSubmission);
    render(
      <NewSessionSurface
        attachmentSupport={{ codex: true }}
        chatWorkspace={CHAT_WORKSPACE}
        draft={{ initialProvider: 'codex', initialWorkspaceId: CHAT_WORKSPACE.workspaceId }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    if (withAttachment) {
      fireEvent.paste(screen.getByRole('combobox'), {
        clipboardData: {
          files: [
            new File([Uint8Array.from([137, 80, 78, 71])], 'retained.png', {
              type: 'image/png',
            }),
          ],
        },
      });
      await screen.findByRole('img', { name: 'retained.png' });
    }

    typeInComposer(draft);
    await pressInComposer('Enter');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ type: inputType }) }),
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(true);

    await pressInComposer('Enter');
    expect(onSubmit).toHaveBeenCalledOnce();

    act(() => rejectSubmission(new Error('session creation failed')));
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(false),
    );
    expect(composerText().trim()).toBe(draft.trim());
    if (withAttachment) {
      expect(screen.getByRole('img', { name: 'retained.png' })).toBeDefined();
    }

    await pressInComposer('Enter');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(false),
    );
  });

  it('clears a first prompt and its submitted attachments only after acceptance', async () => {
    let acceptSubmission!: () => void;
    const pendingSubmission = new Promise<void>((resolve) => {
      acceptSubmission = resolve;
    });
    const onSubmit = vi.fn().mockReturnValue(pendingSubmission);
    render(
      <NewSessionSurface
        attachmentSupport={{ codex: true }}
        chatWorkspace={CHAT_WORKSPACE}
        draft={{ initialProvider: 'codex', initialWorkspaceId: CHAT_WORKSPACE.workspaceId }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    fireEvent.paste(screen.getByRole('combobox'), {
      clipboardData: {
        files: [
          new File([Uint8Array.from([137, 80, 78, 71])], 'accepted.png', {
            type: 'image/png',
          }),
        ],
      },
    });
    await screen.findByRole('img', { name: 'accepted.png' });
    typeInComposer('accepted prompt');
    await pressInComposer('Enter');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());

    expect(composerText()).toBe('accepted prompt');
    expect(screen.getByRole('img', { name: 'accepted.png' })).toBeDefined();

    act(acceptSubmission);
    await waitFor(() => expect(composerText()).toBe(''));
    expect(screen.queryByRole('img', { name: 'accepted.png' })).toBeNull();
  });

  it.each([
    'pi',
    'grok-build',
  ] as const)('blocks unsupported slash commands for %s', async (provider) => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        draft={{ initialProvider: provider, initialWorkspaceId: CHAT_WORKSPACE.workspaceId }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    typeInComposer('/compact ');
    expect(screen.getByRole('button', { name: '/compact' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    await pressInComposer('Enter');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    'claude-code',
    'pi',
    'grok-build',
  ] as const)('blocks unsupported shell commands for %s', async (provider) => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        draft={{ initialProvider: provider, initialWorkspaceId: CHAT_WORKSPACE.workspaceId }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    typeInComposer('$ pwd');
    expect(screen.getByRole('button', { name: '$' }).getAttribute('aria-invalid')).toBe('true');
    await pressInComposer('Enter');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the default model and carries a selected effort into session start', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        draft={{
          initialProvider: 'claude-code',
          initialWorkspaceId: CHAT_WORKSPACE.workspaceId,
        }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    await user.click(screen.getByRole('button', { name: RE_SONNET_5 }));
    await user.click(await screen.findByText('High'));
    typeInComposer('hello');
    await pressInComposer('Enter');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          effort: 'high',
          model: undefined,
          input: { type: 'prompt', content: [{ type: 'text', text: 'hello' }] },
        }),
      ),
    );
  });

  it('shows and submits the last successful provider effort without reselection', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        preferredEfforts={{ 'claude-code': 'medium' }}
        draft={{
          initialProvider: 'claude-code',
          initialWorkspaceId: CHAT_WORKSPACE.workspaceId,
        }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    expect(screen.getByRole('button', { name: RE_MEDIUM_EFFORT })).toBeTruthy();
    typeInComposer('hello again');
    await pressInComposer('Enter');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ effort: 'medium' })),
    );
  });

  it('shows a configured model without turning the default into an explicit override', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        defaultModels={{ 'claude-code': 'custom/claude-model' }}
        draft={{
          initialProvider: 'claude-code',
          initialWorkspaceId: CHAT_WORKSPACE.workspaceId,
        }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    expect(screen.getByRole('button', { name: RE_CUSTOM_CLAUDE_MODEL })).toBeTruthy();
    typeInComposer('hello');
    await pressInComposer('Enter');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ model: undefined })),
    );
  });

  it('does not show a guessed model while configured defaults are loading', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const props = {
      chatWorkspace: CHAT_WORKSPACE,
      draft: {
        initialProvider: 'claude-code' as const,
        initialWorkspaceId: CHAT_WORKSPACE.workspaceId,
      },
      mentionItems: [],
      onMentionQueryChange: vi.fn(),
      onRegisterWorkspace: vi.fn().mockResolvedValue(CHAT_WORKSPACE),
      onSubmit,
      workspaces: [],
    };
    const { rerender } = render(<NewSessionSurface {...props} defaultModels={null} />);

    expect(screen.getByRole('button', { name: RE_MODEL_DEFAULT })).toBeTruthy();
    expect(screen.queryByRole('button', { name: RE_SONNET_5 })).toBeNull();

    typeInComposer('hello');
    await pressInComposer('Enter');
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ model: undefined })),
    );

    rerender(
      <NewSessionSurface {...props} defaultModels={{ 'claude-code': 'configured/claude-model' }} />,
    );
    expect(screen.getByRole('button', { name: RE_CONFIGURED_CLAUDE_MODEL })).toBeTruthy();
  });

  it('shows and explicitly submits the last successful provider model without reselection', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        defaultModels={{ 'claude-code': 'custom/claude-model' }}
        preferredModels={{ 'claude-code': 'claude-opus-4-8' }}
        draft={{
          initialProvider: 'claude-code',
          initialWorkspaceId: CHAT_WORKSPACE.workspaceId,
        }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    expect(screen.getByRole('button', { name: RE_OPUS_4_8 })).toBeTruthy();
    typeInComposer('use my last model');
    await pressInComposer('Enter');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-opus-4-8' })),
    );
  });

  it('submits a remembered dynamic-provider model even without a draft catalog', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        preferredModels={{ opencode: 'anthropic/claude-sonnet-4-6' }}
        draft={{ initialProvider: 'opencode', initialWorkspaceId: CHAT_WORKSPACE.workspaceId }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    expect(screen.getByRole('button', { name: RE_DYNAMIC_CLAUDE_MODEL })).toBeTruthy();
    typeInComposer('use remembered dynamic model');
    await pressInComposer('Enter');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'anthropic/claude-sonnet-4-6' }),
      ),
    );
  });

  it('can return remembered model and effort choices to provider defaults', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        defaultModels={{ 'claude-code': 'configured/claude-model' }}
        preferredEfforts={{ 'claude-code': 'high' }}
        preferredModels={{ 'claude-code': 'claude-opus-4-8' }}
        draft={{
          initialProvider: 'claude-code',
          initialWorkspaceId: CHAT_WORKSPACE.workspaceId,
        }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    await user.click(screen.getByRole('button', { name: RE_OPUS_4_8 }));
    await user.click(await screen.findByRole('menuitem', { name: 'useDefaultModel' }));
    expect(screen.getByRole('button', { name: RE_CONFIGURED_CLAUDE_MODEL })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: RE_CONFIGURED_CLAUDE_MODEL }));
    await user.click(await screen.findByRole('menuitem', { name: 'useDefaultEffort' }));

    typeInComposer('use provider defaults');
    await pressInComposer('Enter');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ model: null, effort: null }),
    );
  });

  it('submits a model only after the user explicitly selects it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        draft={{
          initialProvider: 'claude-code',
          initialWorkspaceId: CHAT_WORKSPACE.workspaceId,
        }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    await user.click(screen.getByRole('button', { name: RE_SONNET_5 }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sonnet 5' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Opus 4.8' }));
    typeInComposer('hello');
    await pressInComposer('Enter');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-opus-4-8' })),
    );
  });

  it('submits compatible Pi catalog choices and suppresses stale effort for models without it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        agentCatalogs={{
          pi: {
            models: [
              { id: 'pi/sonnet', label: 'Pi Sonnet', effortLevels: ['low', 'high'] },
              { id: 'pi/basic', label: 'Pi Basic', effortLevels: [] },
            ],
            policies: [
              { policyId: 'default', name: 'Default' },
              { policyId: 'accept-edits', name: 'Accept edits' },
            ],
            defaultPolicyId: 'default',
          },
        }}
        chatWorkspace={CHAT_WORKSPACE}
        draft={{ initialProvider: 'pi', initialWorkspaceId: CHAT_WORKSPACE.workspaceId }}
        mentionItems={[]}
        onMentionQueryChange={vi.fn()}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    await user.click(screen.getByRole('button', { name: RE_MODEL_DEFAULT }));
    await user.click(await screen.findByRole('menuitem', { name: RE_MODEL_DEFAULT }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Pi Sonnet' }));
    await user.click(screen.getByRole('button', { name: /Pi Sonnet/ }));
    await user.click(await screen.findByText('High'));
    await user.click(screen.getByRole('button', { name: /Default/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: /Accept edits/ }));
    typeInComposer('catalog choices');
    await pressInComposer('Enter');
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'pi/sonnet',
          effort: 'high',
          approvalPolicyId: 'accept-edits',
        }),
      ),
    );

    onSubmit.mockClear();
    await user.click(screen.getByRole('button', { name: /Pi Sonnet/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Pi Sonnet' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Pi Basic' }));
    typeInComposer('no stale effort');
    await pressInComposer('Enter');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ model: 'pi/basic', approvalPolicyId: 'accept-edits' }),
    );
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('effort');
  });

  it('queries mentions in the selected draft workspace and submits the picked file', async () => {
    const user = userEvent.setup();
    const onMentionQueryChange = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        draft={{ initialProvider: 'codex', initialWorkspaceId: CHAT_WORKSPACE.workspaceId }}
        mentionItems={[{ id: 'package.json', label: 'package.json', value: 'package.json' }]}
        onMentionQueryChange={onMentionQueryChange}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    typeInComposer('@pack');
    expect(onMentionQueryChange).toHaveBeenLastCalledWith('/chat', 'pack');
    await user.click(screen.getByRole('option', { name: 'package.json' }));
    await pressInComposer('Enter');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { type: 'prompt', content: [{ type: 'text', text: '"package.json"' }] },
        }),
      ),
    );
  });
});
