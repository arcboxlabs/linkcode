import type { WorkspaceRecord } from '@linkcode/schema';

export interface ProjectRowProps {
  /** Already in recency order; the head is the default pick. */
  workspaces: WorkspaceRecord[];
  workspaceLabel: string;
  cwd: string | null;
  onCwdChange: (cwd: string) => void;
  customPath: string;
  onCustomPathChange: (path: string) => void;
}
