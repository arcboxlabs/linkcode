import { cn } from '../../lib/cn';

export type GitCardShellProps = React.ComponentProps<'div'>;

/** Shared card shell for the branch/pull-request summaries — skeletons use the same shell so loading never shifts layout. */
export function GitCardShell({ className, ...props }: GitCardShellProps): React.ReactNode {
  return (
    <div
      className={cn('flex flex-col gap-2 rounded-lg border border-border bg-card p-3', className)}
      {...props}
    />
  );
}
