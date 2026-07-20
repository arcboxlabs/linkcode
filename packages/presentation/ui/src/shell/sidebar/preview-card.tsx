import { PreviewCardPrimitive } from 'coss-ui/components/preview-card';
import { cn } from '../../lib/cn';

/**
 * Minimal fork of coss-ui's `PreviewCardPopup` (same popup styling) that exposes the positioner's
 * `side`, which the vendored component hard-defaults to `bottom`. Sidebar cards open to the right
 * of their row — like the row dropdown menus — so they never cover the list they annotate.
 * Compose with `PreviewCard` + `PreviewCardTrigger` from coss-ui.
 */
export function SidebarPreviewCardPopup({
  className,
  children,
  ...props
}: PreviewCardPrimitive.Popup.Props): React.ReactNode {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        side="right"
        align="start"
        sideOffset={8}
        className="z-50"
        data-slot="preview-card-positioner"
      >
        <PreviewCardPrimitive.Popup
          className={cn(
            'relative flex w-64 origin-(--transform-origin) text-balance rounded-lg border bg-popover not-dark:bg-clip-padding p-4 text-popover-foreground text-sm shadow-lg/5 transition-[scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]',
            className,
          )}
          data-slot="preview-card-content"
          {...props}
        >
          {children}
        </PreviewCardPrimitive.Popup>
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}
