import type { NewSessionBranchPickerComponentProps } from '@linkcode/ui';
import { NewSessionBranchPicker } from '@linkcode/ui';
import { useState } from 'react';
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
  disabled,
  onSelect,
}: NewSessionBranchPickerComponentProps): React.ReactNode {
  const [open, setOpen] = useState(false);
  const { data: status } = useGitStatus(cwd);
  const {
    data: branchList,
    isLoading,
    error,
  } = useGitBranches(open && status?.isRepo ? cwd : undefined);

  // Status is the immediate repository gate. Detached HEAD remains a repository and stays visible.
  if (!status?.isRepo) return null;

  return (
    <NewSessionBranchPicker
      branches={branchList?.isRepo ? branchList.branches : undefined}
      currentBranch={status.branch}
      disabled={disabled}
      error={error !== undefined && branchList === undefined}
      loading={open && isLoading}
      open={open}
      selectedBranch={selectedBranch}
      onOpenChange={setOpen}
      onSelect={onSelect}
    />
  );
}
