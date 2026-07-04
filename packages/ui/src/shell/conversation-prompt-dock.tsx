import type { PermissionOption } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { CircularProgress } from '../chat/circular-progress';
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
import { Step, StepContent, StepHeader, StepItem } from '../chat/step';
import type { ConversationViewModel } from '../chat/types';
import { cn } from '../lib/cn';

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
        {/* Permission asks block the agent, so they outrank the plan when both are pinned. */}
        {pendingPermissions.length > 0 ? (
          <PermissionPrompt
            items={pendingPermissions}
            respondingPermissions={respondingPermissions}
            onRespondPermission={onRespondPermission}
          />
        ) : null}
        {plan ? <StepPromptRow plan={plan} /> : null}
      </div>
    </div>
  );
}

function StepPromptRow({ plan }: { plan: CurrentPlan }): React.ReactNode {
  const t = useTranslations('workbench.step');
  const entry = plan.item.plan.entries[plan.currentIndex];

  return (
    <Step className="my-0 px-3 py-1.5" defaultOpen={false}>
      <StepHeader title={t('title')}>
        <CircularProgress
          className="size-3.5 shrink-0 text-muted-foreground"
          value={plan.currentIndex + 1}
          max={plan.total}
        />
        <span className="shrink-0">
          {t('title')} {t('progress', { current: plan.currentIndex + 1, total: plan.total })}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-normal text-muted-foreground',
            plan.complete && 'text-muted-foreground line-through',
          )}
        >
          {entry.content}
        </span>
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
      </StepHeader>
      <StepContent>
        {keyedItems(plan.item.plan.entries, stableContentKey).map(({ key, item }) => (
          <StepItem key={key} status={item.status}>
            {item.content}
          </StepItem>
        ))}
      </StepContent>
    </Step>
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
  const [cursor, setCursor] = useState<PermissionPageCursor>({
    requestId: null,
    index: 0,
  });
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
