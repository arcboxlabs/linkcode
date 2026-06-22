import { Checkbox } from 'coss-ui/components/checkbox';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarRail,
  SidebarSeparator,
} from 'coss-ui/components/sidebar';
import { cn } from 'coss-ui/lib/utils';
import { AppSidebarProvider } from '@/components/app-sidebar-provider';

interface FilterSidebarLayoutProps {
  children: React.ReactNode;
  sidebar: React.ReactNode;
  sidebarHeader: React.ReactNode;
  sidebarClassName?: string;
  sidebarHeaderClassName?: string;
  sidebarContentClassName?: string;
  mainClassName?: string;
}

export function FilterSidebarLayout({
  children,
  sidebar,
  sidebarHeader,
  sidebarClassName,
  sidebarHeaderClassName,
  sidebarContentClassName,
  mainClassName,
}: FilterSidebarLayoutProps) {
  return (
    <AppSidebarProvider
      storageKey="filter-sidebar"
      className="min-h-0 flex-1 overflow-hidden"
      style={{ '--sidebar': 'var(--background)' } as React.CSSProperties}
      data-side="left"
    >
      <div className="relative">
        <Sidebar
          collapsible="none"
          className={cn(
            'border-r border-sidebar-border overflow-hidden transition-[width,border] duration-200 ease-linear',
            'group-data-[state=collapsed]/sidebar-wrapper:w-0 group-data-[state=collapsed]/sidebar-wrapper:border-r-0',
            sidebarClassName,
          )}
        >
          <SidebarHeader className={cn('px-4 py-3 border-b border-sidebar-border', sidebarHeaderClassName)}>
            {sidebarHeader}
          </SidebarHeader>
          <SidebarContent
            className={cn('[&>[data-slot=sidebar-separator]:first-child]:hidden', sidebarContentClassName)}
          >
            {sidebar}
          </SidebarContent>
        </Sidebar>
        <SidebarRail className="-right-4" />
      </div>
      <SidebarInset className={cn('min-w-0', mainClassName)}>{children}</SidebarInset>
    </AppSidebarProvider>
  );
}

interface FilterSidebarGroupProps {
  label: string;
  children: React.ReactNode;
}

export function FilterSidebarGroup({ label, children }: FilterSidebarGroupProps) {
  return (
    <>
      <SidebarSeparator className="w-auto!" />
      <SidebarGroup>
        <SidebarGroupLabel className="uppercase tracking-wider text-muted-foreground">{label}</SidebarGroupLabel>
        <SidebarGroupContent>{children}</SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

export interface FilterCheckboxOption<T extends string> {
  value: T;
  label: string;
  dot: string;
  count?: number;
}

interface FilterCheckboxGroupProps<T extends string> {
  options: ReadonlyArray<FilterCheckboxOption<T>>;
  selected: T[];
  onChange: (value: T, checked: boolean) => void;
}

export function FilterCheckboxGroup<T extends string>({ options, selected, onChange }: FilterCheckboxGroupProps<T>) {
  return (
    <div className="flex flex-col gap-0.5">
      {options.map((opt) => (
        <label
          key={opt.value}
          className="flex items-center gap-2 cursor-pointer select-none rounded-lg px-2 py-1 hover:bg-sidebar-accent transition-colors"
        >
          <Checkbox
            checked={selected.includes(opt.value)}
            onCheckedChange={(checked) => onChange(opt.value, checked)}
          />
          <span className={`size-2 rounded-full shrink-0 ${opt.dot}`} />
          <span className="text-sm flex-1">{opt.label}</span>
          {opt.count != null && <span className="text-xs text-muted-foreground tabular-nums">{opt.count}</span>}
        </label>
      ))}
    </div>
  );
}
