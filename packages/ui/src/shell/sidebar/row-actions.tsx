import { cn } from '../../lib/cn';

// Forked from coss-ui's `SidebarMenuAction` (see packages/coss-ui/AGENTS.md): these rows carry
// TWO trailing actions, and the primitive's hardcoded `data-sidebar="menu-action"` would trip
// the menu button's always-on `…:pe-8` reserve — the exact idle dead-space this cluster exists
// to remove. Reveal is opacity-only, so the actions never reflow the row; the button instead
// reclaims their footprint on demand via `ROW_HOVER_PE_CLASS`.

/** Reserves action space on a row's `SidebarMenuButton` only while the actions are shown. */
export const ROW_HOVER_PE_CLASS = 'group-hover/menu-item:pe-12 group-focus-within/menu-item:pe-12';

/**
 * `SidebarMenuAction`'s recipe minus the absolute positioning (the cluster owns that), keeping
 * `hover:bg-background` — the row underneath is already `bg-sidebar-accent` while hovered, so
 * the primitive's `hover:bg-sidebar-accent` would be invisible. `data-popup-open` is base-ui's
 * open-trigger attribute; it keeps the cluster shown while a row menu is open.
 */
export const ROW_ACTION_CLASS = cn(
  'relative flex aspect-square w-5 items-center justify-center rounded-lg p-0 text-muted-foreground outline-hidden ring-sidebar-ring transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2',
  "[&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0",
  // Increases the hit area on touch viewports, matching the primitive.
  'after:absolute after:-inset-2 md:after:hidden',
  'opacity-0 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-popup-open:opacity-100',
);

/** Anchors a row's action buttons over the space `ROW_HOVER_PE_CLASS` frees up on hover. */
export function RowActionsCluster({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactNode {
  return (
    <div
      className={cn(
        '-translate-y-1/2 absolute top-1/2 right-1 flex items-center gap-0.5',
        className,
      )}
    >
      {children}
    </div>
  );
}
