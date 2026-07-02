import type { Plan } from '@linkcode/schema';
import { useTranslations } from 'use-intl';
import { PlanContent, PlanHeader, PlanItem, Plan as PlanPrimitive } from './plan';

export function PlanCard({ plan }: { plan: Plan }): React.ReactNode {
  const t = useTranslations('workbench.plan');

  return (
    <PlanPrimitive>
      <PlanHeader title={t('title')} />
      <PlanContent>
        {plan.entries.map((entry, index) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- entries are regenerated in stable order each update, never reordered by the user; index is a stable position key
          <PlanItem key={index} status={entry.status}>
            {entry.content}
          </PlanItem>
        ))}
      </PlanContent>
    </PlanPrimitive>
  );
}
