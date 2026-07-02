import { BranchStatus } from '@linkcode/ui';
import { useGitStatus } from '../git/hooks';

export interface RuntimeBranchStatusProps {
  cwd: string;
  showDirty?: boolean;
}

/** Hook-backed adapter: each instance owns its own `useGitStatus` poll for one `cwd`. */
export function RuntimeBranchStatus({ cwd, showDirty }: RuntimeBranchStatusProps): React.ReactNode {
  const { data: status } = useGitStatus(cwd);
  return <BranchStatus status={status} showDirty={showDirty} />;
}
