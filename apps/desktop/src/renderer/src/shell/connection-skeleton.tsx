import { Skeleton } from 'coss-ui/components/skeleton';

/**
 * Connection-gate skeleton: approximates the desktop workbench shell (sidebar + new-session main)
 * so the daemon's ~250ms boot reads as the app loading instead of a blank gate or a failure
 * flash. Static shape only — mirrors the shell's default sidebar width (DEFAULT_LAYOUT.sidebarW)
 * so the real UI slides in without layout shift.
 */
export function ConnectionSkeleton(): React.ReactNode {
  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[286px] shrink-0 flex-col gap-3 px-4 pt-12 pb-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-6 h-4 w-16" />
        <div className="flex-1" />
        <Skeleton className="h-5 w-36" />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-8 bg-background p-8">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-44 w-full max-w-2xl rounded-2xl" />
      </main>
    </div>
  );
}
