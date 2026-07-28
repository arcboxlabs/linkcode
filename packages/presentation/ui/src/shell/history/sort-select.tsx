import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { ArrowUpDownIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import type { HistorySortOrder } from './sort';

const ORDERS: readonly HistorySortOrder[] = ['latest', 'oldest', 'project'];

const ORDER_LABEL_KEY = {
  latest: 'sortByLatest',
  oldest: 'sortByOldest',
  project: 'sortByProject',
} as const;

/** Compact arrange picker for the history browser's chrome controls. */
export function HistorySortSelect({
  value,
  onChange,
}: {
  value: HistorySortOrder;
  onChange: (order: HistorySortOrder) => void;
}): React.ReactNode {
  const t = useTranslations('settings.historyImport');
  const items = ORDERS.map((order) => ({ value: order, label: t(ORDER_LABEL_KEY[order]) }));

  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger aria-label={t('sortLabel')} size="sm">
        <ArrowUpDownIcon className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
