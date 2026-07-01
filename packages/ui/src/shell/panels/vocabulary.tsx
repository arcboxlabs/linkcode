import { FilesIcon, FileTextIcon, GlobeIcon, TerminalIcon } from 'lucide-react';

export type PanelSide = 'right' | 'bottom';

export const PANEL_WINDOW_TYPES = ['review', 'terminal', 'browser', 'files'] as const;

export type PanelWindowType = (typeof PANEL_WINDOW_TYPES)[number];

export interface PanelTab {
  id: string;
  type: PanelWindowType;
}

export interface PanelControl {
  id: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}

/** Window labels are translated at the render site (`workbench.panel.window.*`); only icons live here. */
export const PANEL_WINDOW_ICONS: Record<PanelWindowType, React.ReactNode> = {
  review: <FileTextIcon />,
  terminal: <TerminalIcon />,
  browser: <GlobeIcon />,
  files: <FilesIcon />,
};
