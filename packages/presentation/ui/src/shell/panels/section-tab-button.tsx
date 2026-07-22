import { XIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

/** One closable sub-tab inside a panel section (terminal PTYs, file viewers): a square
 * editor-style tab filling the strip height. Tabs split the strip width equally (flex-1,
 * no scrolling) so no tab is ever clipped against a pane divider — the strip itself owns
 * the bottom border, and the active tab paints a 1px overhang across it to merge with the
 * content below. */
export function SectionTabButton({
  label,
  icon,
  active,
  closeLabel,
  title,
  onSelect,
  onClose,
  onMiddleClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  closeLabel: string;
  /** Hover tooltip (e.g. the full file path); defaults to the label. */
  title?: string;
  onSelect: () => void;
  onClose: () => void;
  onMiddleClick?: () => void;
}): React.ReactNode {
  return (
    <div
      className={cn(
        'group relative flex min-w-0 flex-[1_1_auto] items-center border-border border-r text-xs last:border-r-0 [-webkit-app-region:no-drag]',
        active
          ? 'bg-background font-semibold text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-background'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      onAuxClick={(event) => {
        if (!onMiddleClick || event.button !== 1) return;
        event.preventDefault();
        onMiddleClick();
      }}
      onMouseDown={(event) => {
        if (onMiddleClick && event.button === 1) event.preventDefault();
      }}
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
        className={cn(
          'mr-1 size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-50 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100',
          // Inactive tabs reveal the close button on hover only, keeping the width for the
          // label when many tabs share the strip.
          active ? 'flex' : 'hidden group-hover:flex',
        )}
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
