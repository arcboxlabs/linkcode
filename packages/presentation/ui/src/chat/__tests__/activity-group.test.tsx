// @vitest-environment jsdom

import type { ToolCall } from '@linkcode/schema';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityToolGroup } from '../activity-group';
import { ActivityGroup } from '../activity-group';
import { ArtifactHostActionsProvider } from '../artifacts/context';
import type { ConversationItem } from '../types';

function translateKey(key: string): string {
  return key;
}

function translationsMock(): typeof translateKey {
  return translateKey;
}

vi.mock('use-intl', () => ({
  useTranslations: translationsMock,
}));

afterEach(cleanup);

const RE_FILES = /^files/;
const RE_FIRST_EDIT = /^Edit · first\.ts/;
const RE_FIRST_FILE = /first\.ts$/;
const RE_SECOND_FILE = /second\.ts$/;
const WINDOWS_SECOND_PATH = String.raw`C:\repo\packages\second.ts`;

function fileTool(
  id: string,
  kind: Extract<ToolCall['kind'], 'edit' | 'delete'>,
  path: string,
): Extract<ConversationItem, { kind: 'tool' }> {
  return {
    id,
    kind: 'tool',
    turnId: 'turn-1',
    toolCall: {
      toolCallId: id,
      title: kind === 'edit' ? 'Edit' : 'Delete',
      kind,
      status: 'completed',
      rawInput: { file_path: path },
      content: [],
    },
  };
}

describe('ActivityGroup', () => {
  it('keeps file directories out of collapsed summaries and expanded rows', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const group: ActivityToolGroup = {
      type: 'group',
      id: 'files-1',
      bucket: 'files',
      items: [
        fileTool('edit-1', 'edit', '/repo/packages/first.ts'),
        fileTool('delete-1', 'delete', WINDOWS_SECOND_PATH),
      ],
    };

    const { container } = render(
      <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), openFile }}>
        <ActivityGroup group={group} />
      </ArtifactHostActionsProvider>,
    );

    expect(container.textContent).toContain('first.ts, second.ts');
    expect(container.textContent).not.toContain('/repo');
    expect(container.textContent).not.toContain(String.raw`C:\repo`);

    await user.click(screen.getByRole('button', { name: RE_FILES }));

    expect(screen.getByText(RE_FIRST_FILE)).toBeDefined();
    expect(screen.getByText(RE_SECOND_FILE)).toBeDefined();
    expect(container.textContent).not.toContain('/repo');
    expect(container.textContent).not.toContain(String.raw`C:\repo`);

    await user.click(screen.getByRole('button', { name: RE_FIRST_EDIT }));
    await user.click(screen.getByRole('button', { name: 'first.ts' }));
    expect(openFile).toHaveBeenCalledWith('/repo/packages/first.ts');
  });
});
