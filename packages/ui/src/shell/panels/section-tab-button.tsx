import { XIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

/** One closable sub-tab inside a panel section (terminal PTYs, file viewers). */
export function SectionTabButton({
  label,
  icon,
  active,
  closeLabel,
  title,
  onSelect,
  onClose,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  closeLabel: string;
  /** Hover tooltip (e.g. the full file path); defaults to the label. */
  title?: string;
  onSelect: () => void;
  onClose: () => void;
}): React.ReactNode {
  return (
    <div
      className={cn(
        'group flex h-7 max-w-40 shrink-0 items-center overflow-hidden rounded-md border text-xs [-webkit-app-region:no-drag]',
        active
          ? 'border-border bg-card font-semibold text-foreground shadow-xs'
          : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <button
        type="button"
        title={title ?? label}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
      >
        <span className="shrink-0 [&_svg]:size-3.5">{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
      </button>
      <button
        type="button"
        aria-label={closeLabel}
        title={closeLabel}
        className="mr-1 flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-50 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}
