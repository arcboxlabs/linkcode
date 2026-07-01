import { FilesIcon, FileTextIcon, GlobeIcon, TerminalIcon } from 'lucide-react';

export type PanelSide = 'right' | 'bottom';

export const PANEL_WINDOW_TYPES = ['review', 'terminal', 'browser', 'files'] as const;

export type PanelWindowType = (typeof PANEL_WINDOW_TYPES)[number];

export interface PanelWindowMeta {
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
}

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

export const PANEL_WINDOW_META: Record<PanelWindowType, PanelWindowMeta> = {
  review: { label: 'Review', icon: <FileTextIcon /> },
  terminal: { label: 'Terminal', icon: <TerminalIcon /> },
  browser: { label: 'Browser', icon: <GlobeIcon /> },
  files: { label: 'Files', icon: <FilesIcon /> },
};
