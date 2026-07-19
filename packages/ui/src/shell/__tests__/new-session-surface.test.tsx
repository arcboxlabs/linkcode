// @vitest-environment jsdom

import { WorkspaceIdSchema } from '@linkcode/schema';
import { cleanup, render, waitFor } from '@testing-library/react';
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
  it('submits a leading Claude slash command as the initial session input', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewSessionSurface
        chatWorkspace={CHAT_WORKSPACE}
        draft={{
          initialProvider: 'claude-code',
          initialWorkspaceId: CHAT_WORKSPACE.workspaceId,
        }}
        onRegisterWorkspace={vi.fn().mockResolvedValue(CHAT_WORKSPACE)}
        onSubmit={onSubmit}
        workspaces={[]}
      />,
    );

    typeInComposer('/compact');
    await pressInComposer('Enter');

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
        kind: 'claude-code',
        cwd: '/chat',
        workspaceId: CHAT_WORKSPACE.workspaceId,
        model: undefined,
        modeId: undefined,
        input: { type: 'command', name: 'compact' },
      }),
    );
  });
});
