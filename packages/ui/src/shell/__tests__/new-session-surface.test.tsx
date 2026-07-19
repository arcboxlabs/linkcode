// @vitest-environment jsdom

import { WorkspaceIdSchema } from '@linkcode/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NewSessionSurface } from '../new-session-surface';
import { pressInComposer, setupComposerTestDOM, typeInComposer } from './composer-test-utils';

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

    expect(screen.getByRole('button', { name: /modelDefault/ })).toBeTruthy();
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

    await user.click(screen.getByRole('button', { name: /Sonnet 5/ }));
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

    expect(screen.getByRole('button', { name: /custom\/claude-model/ })).toBeTruthy();
    typeInComposer('hello');
    await pressInComposer('Enter');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ model: undefined })),
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

    await user.click(screen.getByRole('button', { name: /Sonnet 5/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sonnet 5' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Opus 4.8' }));
    typeInComposer('hello');
    await pressInComposer('Enter');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-opus-4-8' })),
    );
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
