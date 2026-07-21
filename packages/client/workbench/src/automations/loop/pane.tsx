import type { LoopStatus, SessionId } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from 'coss-ui/components/empty';
import { PlusIcon, RepeatIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import {
  AutomationCreatePane,
  AutomationMasterButton,
  AutomationPaneSkeleton,
} from '../pane-layout';
import { useAutomationsViewStore } from '../store';
import { LoopDetail } from './detail';
import { LoopForm } from './form';
import { useLoops } from './hooks';
import type { LoopListItem } from './items';
import { buildLoopItems } from './items';

const STATUS_BADGE: Record<LoopStatus, 'success' | 'warning' | 'error' | 'secondary'> = {
  running: 'warning',
  succeeded: 'success',
  failed: 'error',
  stopped: 'secondary',
};

export function LoopPane({
  onOpenSession,
}: {
  onOpenSession: (sessionId: SessionId) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const { data: loops, isLoading } = useLoops();
  const view = useAutomationsViewStore((state) => state.view);
  const selectedLoopId = useAutomationsViewStore((state) => state.selectedLoopId);
  const selectLoop = useAutomationsViewStore((state) => state.selectLoop);
  const startCreateLoop = useAutomationsViewStore((state) => state.startCreateLoop);

  if (view.kind === 'create-loop') {
    return (
      <AutomationCreatePane title={t('loop.new')} description={t('loop.createDescription')}>
        <LoopForm />
      </AutomationCreatePane>
    );
  }

  const items = buildLoopItems(loops);

  if (items.length === 0) {
    if (isLoading) return <AutomationPaneSkeleton />;
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RepeatIcon />
          </EmptyMedia>
          <EmptyTitle>{t('loop.empty')}</EmptyTitle>
          <EmptyDescription>{t('loop.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
        <Button onClick={startCreateLoop}>
          <PlusIcon className="size-4" />
          {t('loop.new')}
        </Button>
      </Empty>
    );
  }

  const activeId = selectedLoopId ?? items[0].loopId;
  return (
    <div className="flex min-h-0 flex-1 gap-6 py-4">
      <ul className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto">
        {items.map((item) => (
          <li key={item.loopId}>
            <LoopRow
              item={item}
              active={item.loopId === activeId}
              onSelect={() => selectLoop(item.loopId)}
            />
          </li>
        ))}
      </ul>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-2">
        <LoopDetail loopId={activeId} onOpenSession={onOpenSession} />
      </div>
    </div>
  );
}

function LoopRow({
  item,
  active,
  onSelect,
}: {
  item: LoopListItem;
  active: boolean;
  onSelect: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  return (
    <AutomationMasterButton
      active={active}
      onClick={onSelect}
      icon={<RepeatIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      name={item.name}
      subtitle={t('loop.iterationProgress', {
        count: item.iterationCount,
        max: item.maxIterations,
      })}
      badge={<Badge variant={STATUS_BADGE[item.status]}>{t(`loopStatus.${item.status}`)}</Badge>}
    />
  );
}
