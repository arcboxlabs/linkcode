// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeNewSessionBranchPicker } from '../new-session-branch-picker';

const mocks = vi.hoisted(() => ({
  useGitStatus: vi.fn(),
  useGitBranches: vi.fn(),
}));

vi.mock('../hooks', () => mocks);
vi.mock('@linkcode/ui', () => ({
  NewSessionBranchPicker: ({
    branches,
    currentBranch,
    onOpenChange,
  }: {
    branches?: Array<{ name: string }>;
    currentBranch: string | null;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      <span>{currentBranch}</span>
      <button type="button" onClick={() => onOpenChange(true)}>
        Open branches
      </button>
      {branches?.map((branch) => (
        <span key={branch.name}>{branch.name}</span>
      ))}
    </div>
  ),
}));

beforeEach(() => {
  mocks.useGitStatus.mockReturnValue({ data: undefined });
  mocks.useGitBranches.mockReturnValue({ data: undefined, isLoading: false, error: undefined });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RuntimeNewSessionBranchPicker', () => {
  it('hides while git status is loading and for non-repositories', () => {
    const { rerender } = render(
      <RuntimeNewSessionBranchPicker cwd="/repo" disabled={false} onSelect={vi.fn()} />,
    );
    expect(screen.queryByRole('button')).toBeNull();

    mocks.useGitStatus.mockReturnValue({ data: { isRepo: false } });
    rerender(<RuntimeNewSessionBranchPicker cwd="/other" disabled={false} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows repositories, including their current branch', () => {
    mocks.useGitStatus.mockReturnValue({ data: { isRepo: true, branch: 'main' } });
    render(<RuntimeNewSessionBranchPicker cwd="/repo" disabled={false} onSelect={vi.fn()} />);

    expect(screen.getByText('main')).toBeTruthy();
  });

  it('fetches branches only after the menu opens', () => {
    mocks.useGitStatus.mockReturnValue({ data: { isRepo: true, branch: null } });
    mocks.useGitBranches.mockImplementation((cwd: string | undefined) => ({
      data: cwd
        ? { isRepo: true, branches: [{ name: 'feature', isCurrent: false, lastCommitAt: 1 }] }
        : undefined,
      isLoading: false,
      error: undefined,
    }));
    render(<RuntimeNewSessionBranchPicker cwd="/repo" disabled={false} onSelect={vi.fn()} />);

    expect(mocks.useGitBranches).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Open branches' }));
    expect(mocks.useGitBranches).toHaveBeenLastCalledWith('/repo');
    expect(screen.getByText('feature')).toBeTruthy();
  });
});
