import { SidebarMenuButton, SidebarMenuItem } from 'coss-ui/components/sidebar';
import { useTranslations } from 'use-intl';

export interface ShowMoreToggleProps {
  expanded: boolean;
  onToggle: () => void;
}

/** The Show more/Show less toggle shared by a Projects group's thread list and the flat Chats list. */
export function ShowMoreToggle({ expanded, onToggle }: ShowMoreToggleProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');

  return (
    <SidebarMenuItem>
      <SidebarMenuButton className="hover:bg-transparent" onClick={onToggle}>
        {expanded ? t('showLess') : t('showMore')}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
