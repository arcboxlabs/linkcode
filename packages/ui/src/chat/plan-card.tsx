import type { Plan } from '@linkcode/schema';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { keyedItems, stableContentKey } from './content-keys';
import { Plan as PlanPrimitive, PlanContent, PlanHeader, PlanItem } from './plan';

export function PlanCard({ plan }: { plan: Plan }): ReactNode {
  const t = useTranslations('workbench.plan');

  return (
    <PlanPrimitive>
      <PlanHeader title={t('title')} />
      <PlanContent>
        {keyedItems(plan.entries, stableContentKey).map(({ key, item: entry }) => (
          <PlanItem key={key} status={entry.status}>
            {entry.content}
          </PlanItem>
        ))}
      </PlanContent>
    </PlanPrimitive>
  );
}
