import { Collapsible, CollapsiblePanel } from 'coss-ui/components/collapsible';
import { InputGroup, InputGroupAddon, InputGroupInput } from 'coss-ui/components/input-group';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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
  label: string;
  active?: boolean;
  onClick?: () => void;
}

export interface SettingsSidebarNavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  /** Extra searchable terms (per-tab field labels); never rendered. */
  keywords?: readonly string[];
  /** For items with `children`, drives the accordion expansion only — the row itself never
   * takes the selected pill; the highlighted sub-item is the "you are here" signal. */
  active?: boolean;
  onClick?: () => void;
  /** Navigation-backed row (e.g. `<Link to="…" />`); mutually exclusive with `onClick`. */
  render?: SettingsSidebarNavRender;
  /** Accordion sub-selections, revealed while this item is active. */
  children?: SettingsSidebarNavSubItem[];
}

export interface SettingsSidebarNavGroup {
  key: string;
  label: React.ReactNode;
  items: SettingsSidebarNavItem[];
}

export interface SettingsSidebarNavProps {
  backLabel: React.ReactNode;
  onBack?: () => void;
  /** Navigation-backed back row (e.g. `<Link to="/" />`); mutually exclusive with `onBack`. */
  backRender?: SettingsSidebarNavRender;
  /** Focuses the back control when a non-routed settings overlay opens. */
  backAutoFocus?: boolean;
  searchPlaceholder: string;
  /** Controlled search query; the caller filters `groups` with it. */
  searchValue: string;
  onSearchChange: (value: string) => void;
  /** Enter in the search field — the caller activates the first visible item. */
  onSearchSubmit?: () => void;
  /** Shown instead of the nav when a query matches nothing. */
  searchEmptyLabel: string;
  groups: SettingsSidebarNavGroup[];
}

/** The settings sidebar's inner nav: back row, search field, and grouped category items. */
export function SettingsSidebarNav({
  backLabel,
  onBack,
  backRender,
  backAutoFocus,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  searchEmptyLabel,
  groups,
}: SettingsSidebarNavProps): React.ReactNode {
  const searching = searchValue.trim() !== '';
  const noMatches = searching && groups.every((group) => group.items.length === 0);

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

      <div className="py-2">
        <InputGroup className="h-8 bg-background shadow-none">
          <InputGroupAddon>
            <SearchIcon className="text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={searchPlaceholder}
            nativeInput
            placeholder={searchPlaceholder}
            type="search"
            value={searchValue}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onSearchSubmit?.();
                return;
              }
              // Escape clears an active query locally; when empty it bubbles on to the
              // surface-level handler (the desktop overlay closes on Escape).
              if (event.key === 'Escape' && searchValue !== '') {
                event.stopPropagation();
                onSearchChange('');
              }
            }}
          />
        </InputGroup>
      </div>

      {noMatches ? (
        <p className="px-2 py-4 text-muted-foreground text-sm">{searchEmptyLabel}</p>
      ) : (
        <nav>
          {groups.map((group) =>
            group.items.length === 0 ? null : (
              <SidebarGroup key={group.key} className="p-0 pb-3">
                <SidebarGroupLabel className="text-muted-foreground">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>{group.items.map(renderNavItem)}</SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ),
          )}
        </nav>
      )}
    </div>
  );
}

function renderNavItem(item: SettingsSidebarNavItem): React.ReactNode {
  if (item.children === undefined) {
    return (
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
    );
  }
  // Accordion category: a disclosure row (never the selected pill) whose expansion +
  // single highlighted sub-item carry the selection signal.
  return (
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
  );
}
