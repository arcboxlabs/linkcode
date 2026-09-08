import { Button } from 'coss-ui/components/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from 'coss-ui/components/collapsible';
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';

export function TaskDisclosure({
  title,
  children,
  invalid = false,
}: React.PropsWithChildren<{
  title: string;
  invalid?: boolean;
}>): React.ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      className="border-border border-t pt-4"
      open={open || invalid}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 text-left font-medium text-sm">
        {title}
        <ChevronDownIcon className="size-4 text-muted-foreground group-data-panel-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsiblePanel keepMounted className="motion-reduce:transition-none">
        <div className="flex flex-col gap-4 pt-4">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

export function TaskSelect<T extends string>({
  value,
  onChange,
  items,
  disabled,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string; disabled?: boolean; group?: string }>;
  disabled?: boolean;
  label?: string;
}): React.ReactNode {
  const groups = Map.groupBy(items, (item) => item.group ?? '');
  return (
    <Select
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {Array.from(groups, ([group, members]) => (
          <SelectGroup key={group}>
            {group ? <SelectGroupLabel>{group}</SelectGroupLabel> : null}
            {members.map((item) => (
              <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function TaskLoadError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}): React.ReactNode {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-4 text-sm">
      <p className="text-destructive">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

export function TaskFormError({ message }: { message?: string | null }): React.ReactNode {
  return message ? (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  ) : null;
}
