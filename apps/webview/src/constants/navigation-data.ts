import type { LucideIcon } from 'lucide-react';
import { ClockIcon, SettingsIcon, TerminalIcon } from 'lucide-react';

export interface NavItem {
  title: string;
  /** React Router path. */
  url: string;
  icon: LucideIcon;
  /** When set, the item is active for any path under this prefix (not just exact match). */
  matchPath?: string;
}

export interface SidebarNav {
  label?: string;
  items: NavItem[];
}

export const sidebarNav: SidebarNav[] = [
  {
    items: [
      {
        icon: TerminalIcon,
        title: 'Workbench',
        url: '/',
      },
    ],
  },
  {
    label: 'Activity',
    items: [
      {
        icon: ClockIcon,
        title: 'History',
        url: '/history',
        matchPath: '/history',
      },
      {
        icon: SettingsIcon,
        title: 'Settings',
        url: '/settings',
        matchPath: '/settings',
      },
    ],
  },
];
