import type { ScheduleStatus } from '@linkcode/schema';
import { useRelativeTimeLabel } from '@linkcode/ui';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from 'coss-ui/components/empty';
import { ClockIcon, PlusIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { AutomationMasterButton, AutomationPaneSkeleton } from '../pane-layout';
import { useAutomationsViewStore } from '../store';
import { useSchedules } from './hooks';
import type { AutomationListItem } from './items';
import { buildScheduleItems } from './items';
import { cadenceLabel } from './labels';

const STATUS_BADGE: Record<ScheduleStatus, 'success' | 'warning' | 'secondary'> = {
  active: 'success',
  paused: 'warning',
  completed: 'secondary',
};

export function SchedulePane({ query }: { query: string }): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const { data: schedules, isLoading } = useSchedules();
  const selectedScheduleId = useAutomationsViewStore((state) => state.selectedScheduleId);
  const select = useAutomationsViewStore((state) => state.select);
  const startCreate = useAutomationsViewStore((state) => state.startCreate);
  const normalizedQuery = query.trim().toLowerCase();
  const allItems = buildScheduleItems(schedules);
  const items = normalizedQuery
    ? allItems.filter((item) => item.name.toLowerCase().includes(normalizedQuery))
    : allItems;

  if (items.length === 0) {
    if (isLoading) return <AutomationPaneSkeleton />;
    if (normalizedQuery) {
      return (
        <p className="px-3 py-8 text-center text-muted-foreground text-sm">{t('noMatches')}</p>
      );
    }
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClockIcon />
          </EmptyMedia>
          <EmptyTitle>{t('schedule.empty')}</EmptyTitle>
          <EmptyDescription>{t('schedule.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
        <Button onClick={startCreate}>
          <PlusIcon className="size-4" />
          {t('schedule.new')}
        </Button>
      </Empty>
    );
  }

  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-2">
      {items.map((item) => (
        <li key={item.scheduleId}>
          <ScheduleRow
            item={item}
            active={item.scheduleId === selectedScheduleId}
            onSelect={() => select(item.scheduleId)}
          />
        </li>
      ))}
    </ul>
  );
}

/** A schedule list row; a component of its own for the live next-run clock. */
function ScheduleRow({
  item,
  active,
  onSelect,
}: {
  item: AutomationListItem;
  active: boolean;
  onSelect: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const nextRunLabel = useRelativeTimeLabel(item.nextRunAt ?? 0);
  const cadence = cadenceLabel(item.cadence, t);
  const subtitle =
    item.status === 'active' && item.nextRunAt !== undefined
      ? `${cadence} · ${nextRunLabel}`
      : cadence;

  return (
    <AutomationMasterButton
      active={active}
      onClick={onSelect}
      icon={<ClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      name={item.name}
      subtitle={subtitle}
      badge={<Badge variant={STATUS_BADGE[item.status]}>{t(`status.${item.status}`)}</Badge>}
    />
  );
}
