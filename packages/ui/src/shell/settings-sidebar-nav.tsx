import { Input } from 'coss-ui/components/input';
import { ChevronLeftIcon, SearchIcon } from 'lucide-react';
import { ShellSidebarItem } from './shell-sidebar';

// The row can be either click-driven or navigation-driven (base-ui's cloneElement-based render
// prop); reuse ShellSidebarItem's own `render` type instead of redeclaring `React.ReactElement`.
type SettingsSidebarNavRender = React.ComponentProps<typeof ShellSidebarItem>['render'];

export interface SettingsSidebarNavItem {
  key: string;
  icon: React.ReactNode;
  label: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  /** Navigation-backed row (e.g. `<Link to="…" />`); mutually exclusive with `onClick`. */
  render?: SettingsSidebarNavRender;
}

export interface SettingsSidebarNavProps {
  backLabel: React.ReactNode;
  onBack?: () => void;
  /** Navigation-backed back row (e.g. `<Link to="/" />`); mutually exclusive with `onBack`. */
  backRender?: SettingsSidebarNavRender;
  /** Renders the search row when set; surfaces without search (e.g. history import) omit it. */
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
        {items.map((item) => (
          <ShellSidebarItem
            key={item.key}
            active={item.active}
            onClick={item.onClick}
            render={item.render}
          >
            {item.icon}
            {item.label}
          </ShellSidebarItem>
        ))}
      </nav>
    </div>
  );
}
