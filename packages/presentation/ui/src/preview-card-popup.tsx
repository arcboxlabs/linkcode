import { PreviewCardPrimitive } from 'coss-ui/components/preview-card';
import { cn } from './lib/cn';

export type SidePreviewCardPopupProps = PreviewCardPrimitive.Popup.Props & {
  side?: PreviewCardPrimitive.Positioner.Props['side'];
  align?: PreviewCardPrimitive.Positioner.Props['align'];
  sideOffset?: PreviewCardPrimitive.Positioner.Props['sideOffset'];
};

/**
 * Minimal fork of coss-ui's `PreviewCardPopup` (same popup styling) that exposes the positioner's
 * `side`, which the vendored component hard-defaults to `bottom`. Cards annotating a list open
 * beside it so they never cover the rows they describe. Compose with `PreviewCard` +
 * `PreviewCardTrigger` from coss-ui.
 */
export function SidePreviewCardPopup({
  className,
  children,
  side = 'right',
  align = 'start',
  sideOffset = 8,
  ...props
}: SidePreviewCardPopupProps): React.ReactNode {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        align={align}
        className="z-50"
        data-slot="preview-card-positioner"
        side={side}
        sideOffset={sideOffset}
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
