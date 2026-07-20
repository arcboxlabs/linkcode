import { BranchStatus } from '@linkcode/ui';
import { useGitStatus } from '../git/hooks';

export interface RuntimeBranchStatusProps {
  cwd: string;
  showDirty?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

/** Hook-backed adapter: each instance owns its own `useGitStatus` poll for one `cwd`. */
export function RuntimeBranchStatus({
  cwd,
  showDirty,
  icon,
  className,
}: RuntimeBranchStatusProps): React.ReactNode {
  const { data: status } = useGitStatus(cwd);
  return <BranchStatus status={status} showDirty={showDirty} icon={icon} className={className} />;
}
