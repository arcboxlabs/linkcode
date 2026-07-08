import { Collapsible, CollapsiblePanel } from 'coss-ui/components/collapsible';
import { Input } from 'coss-ui/components/input';
import { ChevronDownIcon, ChevronLeftIcon, SearchIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { ShellSidebarItem } from './shell-sidebar';

// The row can be either click-driven or navigation-driven (base-ui's cloneElement-based render
// prop); reuse ShellSidebarItem's own `render` type instead of redeclaring `React.ReactElement`.
type SettingsSidebarNavRender = React.ComponentProps<typeof ShellSidebarItem>['render'];

export interface SettingsSidebarNavSubItem {
  key: string;
  icon: React.ReactNode;
  label: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}

export interface SettingsSidebarNavItem {
  key: string;
  icon: React.ReactNode;
  label: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  /** Navigation-backed row (e.g. `<Link to="…" />`); mutually exclusive with `onClick`. */
  render?: SettingsSidebarNavRender;
  /** Accordion sub-selections, revealed while this item is active. */
  children?: SettingsSidebarNavSubItem[];
}

export interface SettingsSidebarNavProps {
  backLabel: React.ReactNode;
  onBack?: () => void;
  /** Navigation-backed back row (e.g. `<Link to="/" />`); mutually exclusive with `onBack`. */
  backRender?: SettingsSidebarNavRender;
  /** Renders the search row when set; surfaces without search omit it. */
  searchPlaceholder?: string;
  items: SettingsSidebarNavItem[];
}

/** The settings sidebar's inner nav: back row, optional search placeholder, and category items. */
export function SettingsSidebarNav({
  backLabel,
  onBack,
  backRender,
  searchPlaceholder,
  items,
}: SettingsSidebarNavProps): React.ReactNode {
  return (
    <div className="px-[var(--lc-sidebar-edge,0.5rem)]">
      <ShellSidebarItem onClick={onBack} render={backRender}>
        <ChevronLeftIcon className="size-4" />
        {backLabel}
      </ShellSidebarItem>

      {searchPlaceholder === undefined ? (
        <div className="py-[calc(var(--lc-sidebar-edge,0.5rem)/2)]" />
      ) : (
        <div className="relative py-[var(--lc-sidebar-edge,0.5rem)]">
          <SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 text-muted-foreground" />
          {/* Visual placeholder until settings search is backed by the shared registry. */}
          <Input
            aria-label={searchPlaceholder}
            className="[&_[data-slot=input]]:pl-8"
            nativeInput
            placeholder={searchPlaceholder}
            readOnly
            type="search"
          />
        </div>
      )}

      <nav className="flex flex-col gap-1">
        {items.map((item) =>
          item.children === undefined ? (
            <ShellSidebarItem
              key={item.key}
              active={item.active}
              onClick={item.onClick}
              render={item.render}
            >
              {item.icon}
              {item.label}
            </ShellSidebarItem>
          ) : (
            // Accordion category: selecting it reveals its sub-items until another category takes over.
            <Collapsible key={item.key} open={Boolean(item.active)}>
              <ShellSidebarItem active={item.active} onClick={item.onClick} render={item.render}>
                {item.icon}
                <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                <ChevronDownIcon
                  className={cn(
                    'size-3.5 shrink-0 text-muted-foreground transition-transform',
                    !item.active && '-rotate-90',
                  )}
                />
              </ShellSidebarItem>
              <CollapsiblePanel>
                <div className="flex flex-col gap-1 pt-1 pl-6">
                  {item.children.map((child) => (
                    <ShellSidebarItem key={child.key} active={child.active} onClick={child.onClick}>
                      {child.icon}
                      {child.label}
                    </ShellSidebarItem>
                  ))}
                </div>
              </CollapsiblePanel>
            </Collapsible>
          ),
        )}
      </nav>
    </div>
  );
}
