import type { LoopStatus } from '@linkcode/schema';
import { TaskLoadError } from '@linkcode/ui';
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
import { AutomationActions } from '../actions';
import { AutomationMasterButton, AutomationPaneSkeleton } from '../pane-layout';
import { useAutomationsViewStore } from '../store';
import { useLoops } from './hooks';
import type { LoopListItem } from './items';
import { buildLoopItems } from './items';

const STATUS_BADGE: Record<LoopStatus, 'success' | 'warning' | 'error' | 'secondary'> = {
  running: 'warning',
  succeeded: 'success',
  failed: 'error',
  stopped: 'secondary',
};

export function LoopPane({ query }: { query: string }): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const { data: loops, isLoading, error, mutate } = useLoops();
  const filter = useAutomationsViewStore((state) => state.loopFilter);
  const selectedLoopId = useAutomationsViewStore((state) => state.selectedLoopId);
  const selectLoop = useAutomationsViewStore((state) => state.selectLoop);
  const startCreateLoop = useAutomationsViewStore((state) => state.startCreateLoop);
  const normalizedQuery = query.trim().toLowerCase();
  const tasksById = new Map(loops?.map((task) => [task.loopId, task]));
  const items = buildLoopItems(
    loops?.filter(
      (loop) =>
        (filter === 'all' ||
          (filter === 'running' ? loop.status === 'running' : loop.status !== 'running')) &&
        `${loop.spec.name ?? ''} ${loop.spec.prompt}`.toLowerCase().includes(normalizedQuery),
    ),
  );
  if (error && !loops) {
    return (
      <TaskLoadError
        message={t('loadFailed')}
        retryLabel={t('retry')}
        onRetry={() => {
          void mutate();
        }}
      />
    );
  }

  if (items.length === 0) {
    if (isLoading) return <AutomationPaneSkeleton />;
    if (normalizedQuery || filter !== 'all') {
      return (
        <p className="px-3 py-8 text-center text-muted-foreground text-sm">{t('noMatches')}</p>
      );
    }
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

  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-2">
      {items.map((item) => {
        const task = tasksById.get(item.loopId);
        return (
          <li key={item.loopId} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <LoopRow
                result={task?.error ?? task?.summary}
                item={item}
                active={item.loopId === selectedLoopId}
                onSelect={() => selectLoop(item.loopId)}
              />
            </div>
            {task ? <AutomationActions task={task} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function LoopRow({
  result,
  item,
  active,
  onSelect,
}: {
  result?: string;
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
      subtitle={
        result && item.status !== 'running'
          ? result
          : t('loop.iterationProgress', {
              count: item.iterationCount,
              max: item.maxIterations,
            })
      }
      badge={<Badge variant={STATUS_BADGE[item.status]}>{t(`loopStatus.${item.status}`)}</Badge>}
    />
  );
}
