import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxts/create-fixed-array';

/** The create form's full-pane wrapper: centered column with a heading. */
export function AutomationCreatePane({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-6">
      <div className="flex w-full flex-col gap-5">
        <h2 className="sr-only">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function AutomationMasterButton({
  active,
  onClick,
  icon,
  name,
  subtitle,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  name: string;
  subtitle: string;
  badge: React.ReactNode;
}): React.ReactNode {
  return (
    <button
      data-automation-open
      type="button"
      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-(--density-row-py) text-left transition-colors ${
        active
          ? 'border-border bg-muted'
          : 'border-transparent hover:bg-muted/50 active:bg-muted/50'
      }`}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-sm">{name}</span>
          {badge}
        </span>
        <span className="block truncate text-muted-foreground text-xs">{subtitle}</span>
      </span>
    </button>
  );
}

export function AutomationPaneSkeleton(): React.ReactNode {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 py-2">
      {createFixedArray(3).map((index) => (
        <Skeleton key={index} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}
