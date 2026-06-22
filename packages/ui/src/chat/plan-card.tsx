import type { Plan } from '@linkcode/schema';
import { CircleCheckIcon, CircleDashedIcon, CircleIcon, ListTodoIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';

export function PlanCard({ plan }: { plan: Plan }): ReactElement {
  const t = useTranslations('workbench.plan');

  return (
    <div className="my-1 rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
        <ListTodoIcon className="size-4 text-muted-foreground" />
        {t('title')}
      </div>
      {plan.entries.map((entry, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: plan entries have no stable id
        <div key={i} className="flex items-start gap-2 py-0.5 text-[13px]">
          {entry.status === 'pending' && (
            <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
          )}
          {entry.status === 'in_progress' && (
            <CircleDashedIcon className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
          )}
          {entry.status === 'completed' && (
            <CircleCheckIcon className="mt-0.5 size-3.5 shrink-0 text-success-foreground" />
          )}
          <span
            className={cn(
              'flex-1',
              entry.status === 'completed' && 'text-muted-foreground line-through',
            )}
          >
            {entry.content}
          </span>
        </div>
      ))}
    </div>
  );
}
