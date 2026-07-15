// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactHostActionsProvider } from '../artifacts/context';
import { TurnDiffSummary } from '../turn-diff-summary';

vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const FILES = [
  { path: 'packages/ui/src/chat/one.tsx', additions: 1, deletions: 1 },
  { path: 'packages/ui/src/chat/two.tsx', additions: 2, deletions: 1 },
  { path: 'packages/ui/src/chat/three.tsx', additions: 0, deletions: 3 },
  { path: 'packages/ui/src/chat/four.tsx', additions: 4, deletions: 0 },
] as const;

afterEach(cleanup);

describe('TurnDiffSummary', () => {
  it('opens every file entry and the host review surface', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const onReview = vi.fn();

    render(
      <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), openFile }}>
        <TurnDiffSummary
          edits={{ files: [...FILES], additions: 7, deletions: 5 }}
          onReview={onReview}
        />
      </ArtifactHostActionsProvider>,
    );

    await user.click(screen.getByRole('button', { name: /showMore/ }));
    const fileButtons = FILES.map((file) =>
      screen.getByRole('button', { name: new RegExp(file.path) }),
    );
    expect(fileButtons).toHaveLength(FILES.length);
    for (const button of fileButtons) await user.click(button);
    await user.click(screen.getByRole('button', { name: 'review' }));

    expect(openFile.mock.calls).toEqual(FILES.map((file) => [file.path]));
    expect(onReview).toHaveBeenCalledOnce();
  });
});
