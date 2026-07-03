import type { PermissionOption } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { ChevronLeftIcon, ChevronRightIcon, ListTodoIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { keyedItems, stableContentKey } from '../chat/content-keys';
import type {
  CurrentPlan,
  PermissionConversationItem,
  PermissionPageCursor,
} from '../chat/conversation-prompts';
import {
  resolvePermissionPageIndex,
  selectCurrentPlan,
  selectPendingPermissionItems,
} from '../chat/conversation-prompts';
import { PermissionCard } from '../chat/permission-card';
import { Plan, PlanContent, PlanHeader, PlanItem } from '../chat/plan';
import { Shimmer } from '../chat/shimmer';
import type { ConversationViewModel } from '../chat/types';

/** Actionable prompts pinned above the composer: the current plan and pending permission asks. */
export function ConversationPromptDock({
  conversation,
  permissionDecisions,
  respondingPermissions,
  onRespondPermission,
}: {
  conversation: ConversationViewModel;
  permissionDecisions: ReadonlyMap<string, PermissionOption>;
  respondingPermissions: ReadonlySet<string>;
  onRespondPermission: (requestId: string, option: PermissionOption) => void;
}): React.ReactNode {
  const plan = selectCurrentPlan(conversation);
  const pendingPermissions = selectPendingPermissionItems(conversation).filter(
    (item) => !permissionDecisions.has(item.requestId),
  );

  if (!plan && pendingPermissions.length === 0) return null;

  return (
    <div className="shrink-0 px-4 py-2">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {plan ? <PlanPromptRow plan={plan} /> : null}
        {pendingPermissions.length > 0 ? (
          <PermissionPrompt
            items={pendingPermissions}
            respondingPermissions={respondingPermissions}
            onRespondPermission={onRespondPermission}
          />
        ) : null}
      </div>
    </div>
  );
}

function PlanPromptRow({ plan }: { plan: CurrentPlan }): React.ReactNode {
  const t = useTranslations('workbench.plan');
  const entry = plan.item.plan.entries[plan.currentIndex];

  return (
    <Plan className="my-0 px-3 py-1.5" defaultOpen={false}>
      <PlanHeader title={t('title')}>
        <ListTodoIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0">{t('title')}</span>
        <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">
          {plan.complete ? entry.content : <Shimmer>{entry.content}</Shimmer>}
        </span>
        <Badge size="sm" variant={plan.complete ? 'success' : 'secondary'}>
          {t('progress', { current: plan.currentIndex + 1, total: plan.total })}
        </Badge>
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
      </PlanHeader>
      <PlanContent>
        {keyedItems(plan.item.plan.entries, stableContentKey).map(({ key, item }) => (
          <PlanItem key={key} status={item.status}>
            {item.content}
          </PlanItem>
        ))}
      </PlanContent>
    </Plan>
  );
}

function PermissionPrompt({
  items,
  respondingPermissions,
  onRespondPermission,
}: {
  items: PermissionConversationItem[];
  respondingPermissions: ReadonlySet<string>;
  onRespondPermission: (requestId: string, option: PermissionOption) => void;
}): React.ReactNode {
  const [cursor, setCursor] = useState<PermissionPageCursor>({ requestId: null, index: 0 });
  const pageIndex = resolvePermissionPageIndex(items, cursor);
  const item = items[pageIndex];

  function selectPage(index: number): void {
    setCursor({ requestId: items[index].requestId, index });
  }

  return (
    <PermissionCard
      className="my-0"
      options={item.options}
      pager={
        <PermissionPager
          current={pageIndex + 1}
          total={items.length}
          onNext={() => selectPage(pageIndex + 1)}
          onPrevious={() => selectPage(pageIndex - 1)}
        />
      }
      responding={respondingPermissions.has(item.requestId)}
      toolCall={item.toolCall}
      onRespond={(option) => onRespondPermission(item.requestId, option)}
    />
  );
}

function PermissionPager({
  current,
  total,
  onPrevious,
  onNext,
}: {
  current: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.permission');

  if (total < 2) return null;

  return (
    <div className="flex items-center gap-1">
      <Button
        aria-label={t('previous')}
        disabled={current <= 1}
        size="icon-xs"
        type="button"
        variant="ghost"
        onClick={onPrevious}
      >
        <ChevronLeftIcon />
      </Button>
      <span className="text-muted-foreground text-xs tabular-nums">
        {t('page', { current, total })}
      </span>
      <Button
        aria-label={t('next')}
        disabled={current >= total}
        size="icon-xs"
        type="button"
        variant="ghost"
        onClick={onNext}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}
