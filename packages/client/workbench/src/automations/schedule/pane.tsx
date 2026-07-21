import type { ScheduleStatus, SessionId } from '@linkcode/schema';
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
import {
  AutomationCreatePane,
  AutomationMasterButton,
  AutomationPaneSkeleton,
} from '../pane-layout';
import { useAutomationsViewStore } from '../store';
import { ScheduleDetail } from './detail';
import { ScheduleForm } from './form';
import { useSchedules } from './hooks';
import type { AutomationListItem } from './items';
import { buildScheduleItems } from './items';
import { cadenceLabel } from './labels';

const STATUS_BADGE: Record<ScheduleStatus, 'success' | 'warning' | 'secondary'> = {
  active: 'success',
  paused: 'warning',
  completed: 'secondary',
};

export function SchedulePane({
  onOpenSession,
}: {
  onOpenSession: (sessionId: SessionId) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const { data: schedules, isLoading } = useSchedules();
  const view = useAutomationsViewStore((state) => state.view);
  const selectedScheduleId = useAutomationsViewStore((state) => state.selectedScheduleId);
  const select = useAutomationsViewStore((state) => state.select);
  const startCreate = useAutomationsViewStore((state) => state.startCreate);

  if (view.kind === 'create-schedule') {
    return (
      <AutomationCreatePane title={t('schedule.new')} description={t('schedule.createDescription')}>
        <ScheduleForm />
      </AutomationCreatePane>
    );
  }

  const items = buildScheduleItems(schedules);

  if (items.length === 0) {
    if (isLoading) return <AutomationPaneSkeleton />;
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

  const activeId = selectedScheduleId ?? items[0].scheduleId;
  return (
    <div className="flex min-h-0 flex-1 gap-6 py-4">
      <ul className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto">
        {items.map((item) => (
          <li key={item.scheduleId}>
            <ScheduleRow
              item={item}
              active={item.scheduleId === activeId}
              onSelect={() => select(item.scheduleId)}
            />
          </li>
        ))}
      </ul>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-2">
        <ScheduleDetail scheduleId={activeId} onOpenSession={onOpenSession} />
      </div>
    </div>
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
