import { cn } from '../../lib/cn';
import { FilePreviewCard } from '../file-preview-card';

/** Compact produced-file artifact; opens the host file viewer when available. */
export function FileArtifactCard({
  path,
  className,
}: {
  /** Workspace-relative or absolute path as the agent reported it. */
  path: string;
  className?: string;
}): React.ReactNode {
  return <FilePreviewCard className={cn('w-full max-w-md', className)} path={path} />;
}
