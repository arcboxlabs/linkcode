import { Checkbox } from 'coss-ui/components/checkbox';
import { cn } from 'coss-ui/lib/utils';
import type { ReactElement, ReactNode } from 'react';

export function FilterSidebarLayout({
  children,
  sidebar,
  sidebarHeader,
  className,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  sidebarHeader: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={cn('flex min-h-0 flex-1 overflow-hidden', className)}>
      <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="border-b border-sidebar-border px-4 py-3">{sidebarHeader}</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{sidebar}</div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

export function FilterSidebarGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="space-y-2 border-sidebar-border border-t px-2 py-3 first:border-t-0">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{label}</h3>
      {children}
    </section>
  );
}

export interface FilterCheckboxOption<T extends string> {
  value: T;
  label: string;
  dot?: string;
  count?: number;
}

export function FilterCheckboxGroup<T extends string>({
  options,
  selected,
  onChange,
}: {
  options: ReadonlyArray<FilterCheckboxOption<T>>;
  selected: T[];
  onChange: (value: T, checked: boolean) => void;
}): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      {options.map((option) => (
        <label
          className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-sidebar-accent"
          htmlFor={`filter-${option.value}`}
          key={option.value}
        >
          <Checkbox
            checked={selected.includes(option.value)}
            id={`filter-${option.value}`}
            onCheckedChange={(checked) => onChange(option.value, checked === true)}
          />
          {option.dot && <span className={cn('size-2 shrink-0 rounded-full', option.dot)} />}
          <span className="flex-1 text-sm">{option.label}</span>
          {option.count != null && (
            <span className="text-muted-foreground text-xs tabular-nums">{option.count}</span>
          )}
        </label>
      ))}
    </div>
  );
}
