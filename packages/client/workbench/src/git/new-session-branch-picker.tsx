import { checkGitBranchSwitch, commitGitChanges, createGitBranch } from '@linkcode/sdk';
import type { NewSessionBranchPickerComponentProps } from '@linkcode/ui';
import { NewSessionBranchPicker } from '@linkcode/ui';
import { useState } from 'react';
import { useMutation } from '../runtime/tayori';
import { useGitBranches, useGitStatus } from './hooks';

/** Keying by cwd prevents keepPreviousData from displaying another workspace's git state. */
export function RuntimeNewSessionBranchPicker({
  cwd,
  ...props
}: NewSessionBranchPickerComponentProps): React.ReactNode {
  return <RuntimeNewSessionBranchPickerForWorkspace key={cwd} cwd={cwd} {...props} />;
}

function RuntimeNewSessionBranchPickerForWorkspace({
  cwd,
  selectedBranch,
  branchMode,
  disabled,
  onSelect,
  onSelectMode,
}: NewSessionBranchPickerComponentProps): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [branchesRequested, setBranchesRequested] = useState(false);
  const { data: status, mutate: mutateStatus } = useGitStatus(cwd);
  const {
    data: branchList,
    isLoading,
    error,
    mutate: mutateBranches,
  } = useGitBranches(branchesRequested && status?.isRepo ? cwd : undefined);
  const switchCheck = useMutation(checkGitBranchSwitch);
  const createBranch = useMutation(createGitBranch);
  const commitChanges = useMutation(commitGitChanges);

  // Status is the immediate repository gate. Detached HEAD remains a repository and stays visible.
  if (!status?.isRepo) return null;

  return (
    <NewSessionBranchPicker
      branchMode={branchMode}
      branches={branchList?.isRepo ? branchList.branches : undefined}
      currentBranch={status.branch}
      dirtyFileCount={status.dirtyFileCount}
      disabled={disabled}
      error={error !== undefined && branchList === undefined}
      loading={open && isLoading}
      open={open}
      selectedBranch={selectedBranch}
      onCheckSwitch={(branch) => switchCheck.trigger({ cwd, branch })}
      onCommitChanges={async (message) => {
        await commitChanges.trigger({ cwd, message });
        await mutateStatus();
      }}
      onCreateBranch={async (branch) => {
        await createBranch.trigger({ cwd, branch });
        await mutateBranches();
      }}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setBranchesRequested(true);
      }}
      onSelect={onSelect}
      onSelectMode={onSelectMode}
    />
  );
}
