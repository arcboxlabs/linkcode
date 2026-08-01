// @vitest-environment jsdom

import { checkGitBranchSwitch, commitGitChanges, createGitBranch } from '@linkcode/sdk';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeNewSessionBranchPicker } from '../new-session-branch-picker';

const mocks = vi.hoisted(() => ({
  useGitStatus: vi.fn(),
  useGitBranches: vi.fn(),
  useMutation: vi.fn(),
}));

vi.mock('../hooks', () => mocks);
vi.mock('../../runtime/tayori', () => ({ useMutation: mocks.useMutation }));
vi.mock('@linkcode/ui', () => ({
  NewSessionBranchPicker: ({
    branches,
    currentBranch,
    onOpenChange,
    onCheckSwitch,
    onCommitChanges,
    onCreateBranch,
  }: {
    branches?: Array<{ name: string }>;
    currentBranch: string | null;
    onOpenChange: (open: boolean) => void;
    onCheckSwitch: (branch: string) => Promise<unknown>;
    onCommitChanges: (message: string) => Promise<void>;
    onCreateBranch: (branch: string) => Promise<void>;
  }) => (
    <div>
      <span>{currentBranch}</span>
      <button type="button" onClick={() => onOpenChange(true)}>
        Open branches
      </button>
      {branches?.map((branch) => (
        <span key={branch.name}>{branch.name}</span>
      ))}
      <button
        type="button"
        onClick={() => {
          onCheckSwitch('feature').catch(noop);
        }}
      >
        Check branch
      </button>
      <button
        type="button"
        onClick={() => {
          onCreateBranch('feature').catch(noop);
        }}
      >
        Create branch
      </button>
      <button
        type="button"
        onClick={() => {
          onCommitChanges('save work').catch(noop);
        }}
      >
        Commit changes
      </button>
    </div>
  ),
}));

beforeEach(() => {
  mocks.useGitStatus.mockReturnValue({ data: undefined, mutate: vi.fn() });
  mocks.useGitBranches.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: undefined,
    mutate: vi.fn(),
  });
  mocks.useMutation.mockReturnValue({ trigger: vi.fn(), isMutating: false });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RuntimeNewSessionBranchPicker', () => {
  it('hides while git status is loading and for non-repositories', () => {
    const { rerender } = render(
      <RuntimeNewSessionBranchPicker
        branchMode="local"
        cwd="/repo"
        disabled={false}
        onSelect={vi.fn()}
        onSelectMode={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();

    mocks.useGitStatus.mockReturnValue({ data: { isRepo: false }, mutate: vi.fn() });
    rerender(
      <RuntimeNewSessionBranchPicker
        branchMode="local"
        cwd="/other"
        disabled={false}
        onSelect={vi.fn()}
        onSelectMode={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows repositories, including their current branch', () => {
    mocks.useGitStatus.mockReturnValue({
      data: { isRepo: true, branch: 'main', dirtyFileCount: 0 },
      mutate: vi.fn(),
    });
    render(
      <RuntimeNewSessionBranchPicker
        branchMode="local"
        cwd="/repo"
        disabled={false}
        onSelect={vi.fn()}
        onSelectMode={vi.fn()}
      />,
    );

    expect(screen.getByText('main')).toBeTruthy();
  });

  it('fetches branches only after the menu opens', () => {
    mocks.useGitStatus.mockReturnValue({
      data: { isRepo: true, branch: null, dirtyFileCount: 0 },
      mutate: vi.fn(),
    });
    mocks.useGitBranches.mockImplementation((cwd: string | undefined) => ({
      data: cwd
        ? { isRepo: true, branches: [{ name: 'feature', isCurrent: false, lastCommitAt: 1 }] }
        : undefined,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    }));
    render(
      <RuntimeNewSessionBranchPicker
        branchMode="worktree"
        cwd="/repo"
        disabled={false}
        onSelect={vi.fn()}
        onSelectMode={vi.fn()}
      />,
    );

    expect(mocks.useGitBranches).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Open branches' }));
    expect(mocks.useGitBranches).toHaveBeenLastCalledWith('/repo');
    expect(screen.getByText('feature')).toBeTruthy();
  });

  it('binds branch checks, creation, and commits to SDK mutations', async () => {
    const checkTrigger = vi.fn().mockResolvedValue({ status: 'ready' });
    const createTrigger = vi.fn().mockResolvedValue({ ok: true });
    const commitTrigger = vi.fn().mockResolvedValue({ ok: true });
    const mutateStatus = vi.fn().mockResolvedValue(undefined);
    const mutateBranches = vi.fn().mockResolvedValue(undefined);
    mocks.useGitStatus.mockReturnValue({
      data: { isRepo: true, branch: 'main', dirtyFileCount: 2 },
      mutate: mutateStatus,
    });
    mocks.useGitBranches.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
      mutate: mutateBranches,
    });
    mocks.useMutation.mockImplementation((operation) => ({
      trigger:
        operation === checkGitBranchSwitch
          ? checkTrigger
          : operation === createGitBranch
            ? createTrigger
            : operation === commitGitChanges
              ? commitTrigger
              : vi.fn(),
      isMutating: false,
    }));
    render(
      <RuntimeNewSessionBranchPicker
        branchMode="local"
        cwd="/repo"
        disabled={false}
        onSelect={vi.fn()}
        onSelectMode={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Check branch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create branch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Commit changes' }));

    await waitFor(() => {
      expect(checkTrigger).toHaveBeenCalledWith({ cwd: '/repo', branch: 'feature' });
      expect(createTrigger).toHaveBeenCalledWith({ cwd: '/repo', branch: 'feature' });
      expect(commitTrigger).toHaveBeenCalledWith({ cwd: '/repo', message: 'save work' });
      expect(mutateStatus).toHaveBeenCalledOnce();
      expect(mutateBranches).toHaveBeenCalledOnce();
    });
  });
});
