import { Collapsible, CollapsiblePanel } from 'coss-ui/components/collapsible';
import {
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from 'coss-ui/components/sidebar';
import { ChevronDownIcon, ChevronLeftIcon, SearchIcon } from 'lucide-react';
import { cn } from '../lib/cn';

// The row can be either click-driven or navigation-driven (base-ui's cloneElement-based render
// prop); reuse SidebarMenuButton's own `render` type instead of redeclaring `React.ReactElement`.
type SettingsSidebarNavRender = React.ComponentProps<typeof SidebarMenuButton>['render'];

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
  /** For items with `children`, drives the accordion expansion only — the row itself never
   * takes the selected pill; the highlighted sub-item is the "you are here" signal. */
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
  /** Focuses the back control when a non-routed settings overlay opens. */
  backAutoFocus?: boolean;
  searchPlaceholder: string;
  items: SettingsSidebarNavItem[];
}

/** The settings sidebar's inner nav: back row, search placeholder, and category items. */
export function SettingsSidebarNav({
  backLabel,
  onBack,
  backRender,
  backAutoFocus,
  searchPlaceholder,
  items,
}: SettingsSidebarNavProps): React.ReactNode {
  return (
    <div className="px-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton autoFocus={backAutoFocus} onClick={onBack} render={backRender}>
            <ChevronLeftIcon className="size-4" />
            {backLabel}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>

      <div className="relative py-2">
        <SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 text-muted-foreground" />
        {/* Visual placeholder until settings search is backed by the shared registry. */}
        <SidebarInput
          aria-label={searchPlaceholder}
          className="[&_[data-slot=input]]:pl-8"
          nativeInput
          placeholder={searchPlaceholder}
          readOnly
          type="search"
        />
      </div>

      <nav>
        <SidebarMenu>
          {items.map((item) =>
            item.children === undefined ? (
              <SidebarMenuItem key={item.key}>
                <SidebarMenuButton
                  isActive={Boolean(item.active)}
                  aria-current={item.active ? 'page' : undefined}
                  onClick={item.onClick}
                  render={item.render}
                >
                  {item.icon}
                  {item.label}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : (
              // Accordion category: a disclosure row (never the selected pill) whose expansion +
              // single highlighted sub-item carry the selection signal.
              <SidebarMenuItem key={item.key}>
                <Collapsible open={Boolean(item.active)}>
                  <SidebarMenuButton onClick={item.onClick} render={item.render}>
                    {item.icon}
                    <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                    <ChevronDownIcon
                      className={cn(
                        'size-3.5 shrink-0 text-muted-foreground transition-transform',
                        !item.active && '-rotate-90',
                      )}
                    />
                  </SidebarMenuButton>
                  <CollapsiblePanel>
                    <SidebarMenuSub className="my-1">
                      {item.children.map((child) => (
                        <SidebarMenuSubItem key={child.key}>
                          <SidebarMenuButton
                            className="h-7"
                            isActive={Boolean(child.active)}
                            aria-current={child.active ? 'page' : undefined}
                            onClick={child.onClick}
                          >
                            {child.icon}
                            {child.label}
                          </SidebarMenuButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsiblePanel>
                </Collapsible>
              </SidebarMenuItem>
            ),
          )}
        </SidebarMenu>
      </nav>
    </div>
  );
}
