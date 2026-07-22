import {
  CompassIcon,
  FileDiffIcon,
  FolderCodeIcon,
  SmartphoneIcon,
  SquareTerminalIcon,
} from 'lucide-react';

export type PanelSide = 'right' | 'bottom';

export const PANEL_WINDOW_TYPES = ['diff', 'terminal', 'browser', 'files'] as const;

export type PanelWindowType = (typeof PANEL_WINDOW_TYPES)[number];

/** The right panel's fixed sections — a subset of {@link PanelWindowType}. */
export const PANEL_SECTIONS = ['diff', 'terminal', 'browser', 'files'] as const;

/** On-demand right-panel sections, added (and removed) via the section strip's + menu. */
export const OPTIONAL_PANEL_SECTIONS = ['simulator'] as const;

export type OptionalPanelSection = (typeof OPTIONAL_PANEL_SECTIONS)[number];

export type PanelSection = (typeof PANEL_SECTIONS)[number];

export interface PanelTab {
  id: string;
  type: PanelWindowType;
}

/** One instance tab within a section (e.g. one terminal); the section itself supplies the type. */
export interface PanelSectionTab {
  id: string;
}

export interface PanelControl {
  id: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}

/** Window labels are translated at the render site (`workbench.panel.window.*`); only icons live here. */
export const PANEL_WINDOW_ICONS: Record<PanelWindowType | OptionalPanelSection, React.ReactNode> = {
  diff: <FileDiffIcon />,
  terminal: <SquareTerminalIcon />,
  browser: <CompassIcon />,
  files: <FolderCodeIcon />,
  simulator: <SmartphoneIcon />,
};

/** Shared tab recipe: the active/inactive halves of every panel tab button's className. */
export const PANEL_TAB_ACTIVE_CLASSNAME =
  'border-transparent bg-accent font-semibold text-foreground';
export const PANEL_TAB_INACTIVE_CLASSNAME =
  'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground';
