import { cn } from '../../lib/cn';

// These rows carry two coss-ui icon buttons, so they reserve trailing space only while the
// actions are visible. Reveal is opacity-only and never reflows the row.

/** Reserves action space on a row's `SidebarMenuButton` only while the actions are shown. */
export const ROW_HOVER_PE_CLASS =
  'group-hover/menu-item:pe-15 group-has-[:focus-visible]/menu-item:pe-15 group-has-data-popup-open/menu-item:pe-15 sm:group-hover/menu-item:pe-13 sm:group-has-[:focus-visible]/menu-item:pe-13 sm:group-has-data-popup-open/menu-item:pe-13';

/** Same reservation for rows carrying a third action (the thread IM ellipsis menu). */
export const ROW_HOVER_PE_WIDE_CLASS =
  'group-hover/menu-item:pe-21 group-has-[:focus-visible]/menu-item:pe-21 group-has-data-popup-open/menu-item:pe-21 sm:group-hover/menu-item:pe-19 sm:group-has-[:focus-visible]/menu-item:pe-19 sm:group-has-data-popup-open/menu-item:pe-19';

/** Visibility behavior shared by the coss-ui action buttons; base-ui's `data-popup-open`
 * open-trigger attribute keeps the cluster stable while its popup is open. */
export const ROW_ACTION_CLASS =
  'opacity-0 transition-opacity hover:bg-transparent data-pressed:bg-transparent group-hover/menu-item:opacity-100 group-has-[:focus-visible]/menu-item:opacity-100 group-has-data-popup-open/menu-item:opacity-100';

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
      className={cn('-translate-y-1/2 absolute top-1/2 right-1 flex items-center gap-0', className)}
    >
      {children}
    </div>
  );
}
