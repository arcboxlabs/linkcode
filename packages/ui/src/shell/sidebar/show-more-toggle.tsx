import { useTranslations } from 'use-intl';

export interface ShowMoreToggleProps {
  expanded: boolean;
  onToggle: () => void;
}

/** The Show more/Show less toggle shared by a Projects group's thread list and the flat Chats list. */
export function ShowMoreToggle({ expanded, onToggle }: ShowMoreToggleProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');

  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full rounded-md px-[var(--lc-sidebar-edge,0.5rem)] py-1 text-left text-muted-foreground text-xs outline-none hover:bg-sidebar-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {expanded ? t('showLess') : t('showMore')}
    </button>
  );
}
