import { SidebarMenuButton, SidebarMenuItem } from 'coss-ui/components/sidebar';
import { useTranslations } from 'use-intl';

export interface ShowMoreToggleProps {
  expanded: boolean;
  onToggle: () => void;
  /** Extra classes on the row `li` — the Projects tree indents its rows with `pl-3`. */
  className?: string;
}

/** The Show more/Show less toggle shared by a Projects group's thread list and the flat Chats list. */
export function ShowMoreToggle({
  expanded,
  onToggle,
  className,
}: ShowMoreToggleProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');

  return (
    <SidebarMenuItem className={className}>
      <SidebarMenuButton size="sm" className="text-muted-foreground" onClick={onToggle}>
        {expanded ? t('showLess') : t('showMore')}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
