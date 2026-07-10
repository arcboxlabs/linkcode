import { cn } from '../../lib/cn';

// These rows carry two coss-ui icon buttons, so they reserve trailing space only while the
// actions are visible. Reveal is opacity-only and never reflows the row.

/** Reserves action space on a row's `SidebarMenuButton` only while the actions are shown. */
export const ROW_HOVER_PE_CLASS =
  'group-hover/menu-item:pe-16 group-focus-within/menu-item:pe-16 sm:group-hover/menu-item:pe-14 sm:group-focus-within/menu-item:pe-14';

/**
 * Visibility behavior shared by the coss-ui action buttons. `data-popup-open` is base-ui's
 * open-trigger attribute; it keeps the menu trigger shown while its popup is open.
 */
export const ROW_ACTION_CLASS = cn(
  'opacity-0 transition-opacity hover:bg-transparent',
  'group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-popup-open:opacity-100',
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
