import { XIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';

/** One closable sub-tab inside a panel section (terminal PTYs, file viewers): a square
 * editor-style tab filling the strip height. The strip's bottom border is drawn per tab so
 * the active tab can break it and merge with the content below. */
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
  const rootRef = useRef<HTMLDivElement>(null);
  // The strip scrolls with a hidden scrollbar, so an activated tab (e.g. a file just opened
  // from the tree, appended past the overflow edge) must bring itself into view.
  useEffect(() => {
    if (active) rootRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <div
      ref={rootRef}
      className={cn(
        'group flex max-w-40 shrink-0 items-center overflow-hidden border-border border-r text-xs [-webkit-app-region:no-drag]',
        active
          ? 'bg-background font-semibold text-foreground'
          : 'border-b text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <button
        type="button"
        title={title ?? label}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
