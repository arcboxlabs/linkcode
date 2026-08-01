// @vitest-environment jsdom

import type { GitBranch } from '@linkcode/schema';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewSessionBranchPickerProps } from '../new-session-branch-picker';
import { NewSessionBranchPicker } from '../new-session-branch-picker';

function translate(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translate,
}));

const BRANCHES: GitBranch[] = [
  { name: 'main', isCurrent: true, lastCommitAt: 2 },
  { name: 'feature/search', isCurrent: false, lastCommitAt: 1 },
  { name: 'bugfix/login', isCurrent: false, lastCommitAt: 0 },
];
const FEATURE_SEARCH_PATTERN = /feature\/search/;
const LOCAL_PATTERN = /local/i;

type PickerProps = Omit<NewSessionBranchPickerProps, 'open' | 'onOpenChange'>;

function Picker(props: PickerProps): React.ReactNode {
  const [open, setOpen] = useState(false);
  return <NewSessionBranchPicker {...props} open={open} onOpenChange={setOpen} />;
}

function pickerProps(overrides: Partial<PickerProps> = {}): PickerProps {
  return {
    branches: BRANCHES,
    branchMode: 'local',
    currentBranch: 'main',
    dirtyFileCount: 3,
    disabled: false,
    error: false,
    loading: false,
    onCheckSwitch: vi.fn().mockResolvedValue({ status: 'ready' }),
    onCommitChanges: vi.fn().mockResolvedValue(undefined),
    onCreateBranch: vi.fn().mockResolvedValue(undefined),
    onSelect: vi.fn(),
    onSelectMode: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe('NewSessionBranchPicker', () => {
  it('searches local branches and creates a validated branch', async () => {
    const user = userEvent.setup();
    const onCreateBranch = vi.fn().mockResolvedValue(undefined);
    const onSelect = vi.fn();
    render(<Picker {...pickerProps({ onCreateBranch, onSelect })} />);

    await user.click(screen.getByRole('button', { name: 'branch' }));
    expect(await screen.findByText('branchUncommitted')).toBeDefined();
    const search = await screen.findByRole('searchbox', { name: 'branchSearch' });
    await user.type(search, 'login');
    expect(screen.queryByText('feature/search')).toBeNull();
    expect(screen.getByText('bugfix/login')).toBeDefined();

    await user.click(screen.getByRole('menuitem', { name: 'branchCreate' }));
    expect(await screen.findByRole('heading', { name: 'branchCreateTitle' })).toBeDefined();
    const name = screen.getByRole('textbox', { name: 'branchName' });
    await user.type(name, 'feature/');
    expect(screen.getByText('branchNameError.trailingSlash')).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'branchCreateAction' }).hasAttribute('disabled'),
    ).toBe(true);

    await user.clear(name);
    await user.type(name, 'feature/new-picker');
    await user.click(screen.getByRole('button', { name: 'branchCreateAction' }));
    await waitFor(() => expect(onCreateBranch).toHaveBeenCalledWith('feature/new-picker'));
    expect(onSelect).toHaveBeenCalledWith('feature/new-picker');
  });

  it('offers a quick commit when a local branch switch would overwrite changes', async () => {
    const user = userEvent.setup();
    const onCheckSwitch = vi.fn().mockResolvedValue({
      status: 'conflict',
      files: [{ path: 'src/changed.ts', additions: 3, deletions: 1 }],
    });
    const onCommitChanges = vi.fn().mockResolvedValue(undefined);
    const onSelect = vi.fn();
    render(<Picker {...pickerProps({ onCheckSwitch, onCommitChanges, onSelect })} />);

    await user.click(screen.getByRole('button', { name: 'branch' }));
    await user.click(await screen.findByRole('menuitemradio', { name: FEATURE_SEARCH_PATTERN }));

    expect(await screen.findByRole('heading', { name: 'branchConflictTitle' })).toBeDefined();
    expect(screen.getByText('src/changed.ts')).toBeDefined();
    expect(screen.getByText('+3')).toBeDefined();
    expect(screen.getByText('-1')).toBeDefined();
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'branchConflictCommitAction' }));
    expect(await screen.findByRole('heading', { name: 'branchCommitTitle' })).toBeDefined();
    const message = screen.getByRole('textbox', { name: 'branchCommitMessage' });
    await user.clear(message);
    await user.type(message, 'save local work');
    await user.click(screen.getByRole('button', { name: 'branchCommitAction' }));

    await waitFor(() => expect(onCommitChanges).toHaveBeenCalledWith('save local work'));
    expect(onSelect).toHaveBeenCalledWith('feature/search');
  });

  it('selects a worktree branch without checking the original checkout', async () => {
    const user = userEvent.setup();
    const onCheckSwitch = vi.fn();
    const onSelect = vi.fn();
    render(<Picker {...pickerProps({ branchMode: 'worktree', onCheckSwitch, onSelect })} />);

    await user.click(screen.getByRole('button', { name: 'branch' }));
    await user.click(await screen.findByRole('menuitemradio', { name: FEATURE_SEARCH_PATTERN }));

    expect(onCheckSwitch).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith('feature/search');
  });

  it('checks the selected branch before changing from worktree to local mode', async () => {
    const user = userEvent.setup();
    const onCheckSwitch = vi.fn().mockResolvedValue({
      status: 'conflict',
      files: [{ path: 'src/changed.ts', additions: 3, deletions: 1 }],
    });
    const onCommitChanges = vi.fn().mockResolvedValue(undefined);
    const onSelect = vi.fn();
    const onSelectMode = vi.fn();
    render(
      <Picker
        {...pickerProps({
          branchMode: 'worktree',
          selectedBranch: 'feature/search',
          onCheckSwitch,
          onCommitChanges,
          onSelect,
          onSelectMode,
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'branchMode' }));
    await user.click(await screen.findByRole('menuitemradio', { name: LOCAL_PATTERN }));
    expect(await screen.findByRole('heading', { name: 'branchConflictTitle' })).toBeDefined();
    expect(onCheckSwitch).toHaveBeenCalledWith('feature/search');
    expect(onSelectMode).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'branchConflictCommitAction' }));
    await user.click(await screen.findByRole('button', { name: 'branchCommitAction' }));

    await waitFor(() => expect(onCommitChanges).toHaveBeenCalledOnce());
    expect(onSelect).toHaveBeenCalledWith('feature/search');
    expect(onSelectMode).toHaveBeenCalledWith('local');
  });
});
