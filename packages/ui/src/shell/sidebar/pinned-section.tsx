import type { SessionId, SessionInfo } from '@linkcode/schema';
import { AccordionItem, AccordionPanel } from 'coss-ui/components/accordion';
import { SidebarGroup, SidebarMenu } from 'coss-ui/components/sidebar';
import { useTranslations } from 'use-intl';
import { SectionAccordionTrigger } from './section-header';
import { ShowMoreToggle } from './show-more-toggle';
import type { ThreadImMenuComponentType } from './thread-im-menu';
import { ThreadRow } from './thread-row';

export interface PinnedSectionProps {
  /** The subset of the pinned group's sessions to render, honoring preview truncation. */
  sessions: SessionInfo[];
  hasOverflow: boolean;
  previewExpanded: boolean;
  /** The group key `onTogglePreviewExpanded` is called with. */
  groupKey: string;
  /** The pinned group's `collapseKey` — scopes row dragging to this section. */
  sortKey: string;
  activeId: SessionId | null;
  onSelect: (id: SessionId) => void;
  onClose: (id: SessionId) => void;
  onToggleSessionPinned: (id: SessionId) => void;
  onTogglePreviewExpanded: (groupKey: string) => void;
  ImMenuComponent?: ThreadImMenuComponentType;
}

/** Every pinned thread across all groups, flat. Only rendered while something is pinned (hence
 * no empty state or skeleton); unpinning a row returns the thread to its original group. */
export function PinnedSection({
  sessions,
  hasOverflow,
  previewExpanded,
  groupKey,
  sortKey,
  activeId,
  onSelect,
  onClose,
  onToggleSessionPinned,
  onTogglePreviewExpanded,
  ImMenuComponent,
}: PinnedSectionProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');

  return (
    <AccordionItem value="pinned" className="border-b-0" render={<SidebarGroup />}>
      <SectionAccordionTrigger>{t('pinned')}</SectionAccordionTrigger>
      <AccordionPanel className="pb-0 text-sidebar-foreground">
        <SidebarMenu className="gap-0.5">
          {sessions.map((session, index) => (
            <ThreadRow
              key={session.sessionId}
              active={session.sessionId === activeId}
              pinned
              sortIndex={index}
              sortGroup={sortKey}
              session={session}
              onSelect={() => onSelect(session.sessionId)}
              onClose={() => onClose(session.sessionId)}
              onTogglePin={() => onToggleSessionPinned(session.sessionId)}
              ImMenuComponent={ImMenuComponent}
            />
          ))}
          {hasOverflow && (
            <ShowMoreToggle
              expanded={previewExpanded}
              onToggle={() => onTogglePreviewExpanded(groupKey)}
            />
          )}
        </SidebarMenu>
      </AccordionPanel>
    </AccordionItem>
  );
}
