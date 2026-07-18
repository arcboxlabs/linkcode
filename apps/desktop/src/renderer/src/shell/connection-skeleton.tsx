import { AnimatedMark } from '@linkcode/ui';
import { Skeleton } from 'coss-ui/components/skeleton';

/**
 * Connection-gate loading state: a sidebar skeleton mirroring the shell's default width
 * (DEFAULT_LAYOUT.sidebarW) plus the breathing brand mark in the main pane, so the daemon's
 * ~250ms boot reads as the app loading instead of a blank gate or a failure flash.
 */
export function ConnectionSkeleton(): React.ReactNode {
  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[288px] shrink-0 flex-col gap-3 px-4 pt-12 pb-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-6 h-4 w-16" />
        <div className="flex-1" />
        <Skeleton className="h-5 w-36" />
      </aside>
      <main className="flex min-w-0 flex-1 items-center justify-center bg-background p-8">
        <AnimatedMark className="text-foreground" />
      </main>
    </div>
  );
}
