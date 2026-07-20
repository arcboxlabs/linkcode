import type { PanelSection, PanelSide, PanelTab, PanelWindowType } from '@linkcode/ui/shell/panels';
import { PANEL_SECTIONS, PANEL_WINDOW_TYPES } from '@linkcode/ui/shell/panels';
import { clamp } from 'foxts/clamp';
import { z } from 'zod';

export type { PanelSide } from '@linkcode/ui/shell/panels';
export type PanelExpansionTarget = 'editor-row' | 'workbench';

export interface PanelState {
  open: boolean;
  tabs: PanelTab[];
  activeTabId: string | null;
}

/** One open file in the right panel's files section. */
export interface FileSectionTab {
  id: string;
  path: string;
}

/** The right panel's files section: viewer sub-tabs for files opened from chat. */
export interface RightPanelFilesState {
  tabs: FileSectionTab[];
  activeTabId: string | null;
}

/** The right panel's single-instance in-app browser (Electron webview). */
export interface RightPanelBrowserState {
  url: string | null;
}

/** The right panel: fixed Diff/Terminal/Browser/Files sections, with per-instance
 * sub-tabs for Terminal (PTYs) and Files (viewers). */
export interface RightPanelState {
  open: boolean;
  activeSection: PanelSection;
  files: RightPanelFilesState;
  browser: RightPanelBrowserState;
}

export interface LayoutState {
  sidebarW: number;
  rightW: number;
  bottomH: number;
}

export interface DesktopShellState {
  sidebarOpen: boolean;
  layout: LayoutState;
  expansionStack: PanelSide[];
  rightPanel: RightPanelState;
  bottomPanel: PanelState;
}

export interface PersistedDesktopShellState {
  version: 3;
  sidebarOpen: boolean;
  layout: LayoutState;
  expansionStack: PanelSide[];
  rightPanel: PersistedRightPanelState;
  bottomPanel: PersistedPanelState;
}

export interface PersistedRightPanelState {
  open: boolean;
  activeSection: PanelSection;
  fileTabPaths: string[];
  activeFileTabIndex: number;
  browserUrl: string | null;
}

export interface PersistedPanelState {
  open: boolean;
  tabs: PanelWindowType[];
  activeTabIndex: number;
}

export const DESKTOP_SHELL_STORAGE_KEY = 'linkcode.desktop.shell-state:v3';

export const SIDEBAR_MIN_SIZE = 240;
export const SIDEBAR_MAX_SIZE = 520;
export const RIGHT_PANEL_MIN_SIZE = 320;
export const RIGHT_PANEL_MAX_SIZE = 820;
export const BOTTOM_PANEL_MIN_SIZE = 150;
export const BOTTOM_PANEL_MAX_SIZE = 560;
export const MIN_MAIN_SIZE = 360;

/* 8px grid; sidebarW + the 824px chat column (max-w-3xl + px-7) + rightW is the first-launch
 * window width cap (1560) in main/window-state.ts. */
export const DEFAULT_LAYOUT: LayoutState = {
  sidebarW: 288,
  rightW: 440,
  bottomH: 240,
};

export const PANEL_EXPANSION_TARGET: Record<PanelSide, PanelExpansionTarget> = {
  right: 'editor-row',
  bottom: 'workbench',
};

/** Defensive cap on the file tab count restored from persisted state. */
const MAX_PERSISTED_RIGHT_FILE_TABS = 20;

let tabSequence = 0;

const PanelSideSchema = z.enum(['right', 'bottom']);
const PanelSectionSchema = z.enum(PANEL_SECTIONS);
const PanelWindowTypeSchema = z.enum(PANEL_WINDOW_TYPES);
const NonTerminalPanelWindowTypeSchema = PanelWindowTypeSchema.exclude(['terminal']);
const FiniteNumberSchema = z.number();

const PersistedLayoutSchema = z
  .object({
    sidebarW: FiniteNumberSchema.catch(DEFAULT_LAYOUT.sidebarW),
    rightW: FiniteNumberSchema.catch(DEFAULT_LAYOUT.rightW),
    bottomH: FiniteNumberSchema.catch(DEFAULT_LAYOUT.bottomH),
  })
  .catch(DEFAULT_LAYOUT)
  .transform(normalizeLayout);

const PersistedExpansionStackSchema = z
  .array(z.unknown())
  .catch([])
  .transform((items) =>
    items.flatMap((item) => {
      const parsed = PanelSideSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  );

export function createDefaultDesktopShellState(): DesktopShellState {
  return {
    sidebarOpen: true,
    layout: DEFAULT_LAYOUT,
    expansionStack: [],
    rightPanel: createDefaultRightPanelState(),
    bottomPanel: { open: false, tabs: [], activeTabId: null },
  };
}

export function createDefaultRightPanelState(): RightPanelState {
  return {
    open: false,
    activeSection: 'diff',
    files: { tabs: [], activeTabId: null },
    browser: { url: null },
  };
}

export function createPanelState(open: boolean, type: PanelWindowType): PanelState {
  const tab = createTab(type);
  return {
    open,
    tabs: [tab],
    activeTabId: tab.id,
  };
}

export function createTab(type: PanelWindowType): PanelTab {
  tabSequence += 1;
  return { id: `${type}-${tabSequence}`, type };
}

/** Brings `section` forward. Terminal sessions are owned by the shared workbench store. */
export function revealSectionState(
  panel: RightPanelState,
  section: PanelSection,
  open: boolean,
): RightPanelState {
  return {
    ...panel,
    open,
    activeSection: section,
  };
}

export function createRightFileTab(path: string): FileSectionTab {
  tabSequence += 1;
  return { id: `right-file-${tabSequence}`, path };
}

/** Removes a section sub-tab, falling back the active tab to a neighbor if it was the one closed. */
export function closeSectionTabState<Tab extends { id: string }>(
  section: { tabs: Tab[]; activeTabId: string | null },
  id: string,
): { tabs: Tab[]; activeTabId: string | null } {
  const { tabs, activeTabId } = section;
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return section;

  const nextTabs = tabs.filter((tab) => tab.id !== id);
  const nextActiveId =
    activeTabId === id ? (nextTabs[clamp(index, 0, nextTabs.length - 1)]?.id ?? null) : activeTabId;

  return { tabs: nextTabs, activeTabId: nextActiveId };
}

/** Opens (or re-focuses) a file viewer tab; one tab per distinct path. */
export function openFileTabState(files: RightPanelFilesState, path: string): RightPanelFilesState {
  const existing = files.tabs.find((tab) => tab.path === path);
  if (existing) {
    return existing.id === files.activeTabId ? files : { ...files, activeTabId: existing.id };
  }
  const tab = createRightFileTab(path);
  return { tabs: [...files.tabs, tab], activeTabId: tab.id };
}

export function pushExpandedPanel(stack: PanelSide[], side: PanelSide): PanelSide[] {
  return [...removeExpandedPanel(stack, side), side];
}

export function removeExpandedPanel(stack: PanelSide[], side: PanelSide): PanelSide[] {
  return stack.filter((item) => item !== side);
}

export function normalizeExpansionStack(
  value: PanelSide[],
  rightPanel: RightPanelState,
  bottomPanel: PanelState,
): PanelSide[] {
  return value.reduce<PanelSide[]>((stack, side) => {
    if (!isPanelOpen(side, rightPanel, bottomPanel)) return stack;
    return pushExpandedPanel(stack, side);
  }, []);
}

export function getExpandedPanel(
  expansionStack: PanelSide[],
  rightPanelOpen: boolean,
  bottomPanelOpen: boolean,
): PanelSide | null {
  for (let index = expansionStack.length - 1; index >= 0; index -= 1) {
    const side = expansionStack[index];
    if (side === 'right' && rightPanelOpen) return 'right';
    if (side === 'bottom' && bottomPanelOpen) return 'bottom';
  }
  return null;
}

/** Chooses the only terminal surface allowed to send PTY input/resize. A maximized panel owns
 * interaction because the other panel is inert behind its overlay. */
export function getTerminalPanelOwner(
  expandedPanel: PanelSide | null,
  rightPanelOpen: boolean,
  rightPanelSection: PanelSection,
  bottomPanelOpen: boolean,
): PanelSide | null {
  if (expandedPanel === 'bottom') return bottomPanelOpen ? 'bottom' : null;
  if (expandedPanel === 'right') {
    return rightPanelOpen && rightPanelSection === 'terminal' ? 'right' : null;
  }
  if (rightPanelOpen && rightPanelSection === 'terminal') return 'right';
  return bottomPanelOpen ? 'bottom' : null;
}

export function getExpandedPanelForTarget(
  side: PanelSide | null,
  target: PanelExpansionTarget,
): PanelSide | null {
  if (!side) return null;
  return PANEL_EXPANSION_TARGET[side] === target ? side : null;
}

export function normalizeLayout(layout: LayoutState): LayoutState {
  return {
    sidebarW: clamp(layout.sidebarW, SIDEBAR_MIN_SIZE, SIDEBAR_MAX_SIZE),
    rightW: clamp(layout.rightW, RIGHT_PANEL_MIN_SIZE, RIGHT_PANEL_MAX_SIZE),
    bottomH: clamp(layout.bottomH, BOTTOM_PANEL_MIN_SIZE, BOTTOM_PANEL_MAX_SIZE),
  };
}

export function readPaneSize(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export const PersistedDesktopShellStateSchema = createPersistedShellStateSchema();

export function parsePersistedDesktopShellState(value: unknown): DesktopShellState {
  const parsed = PersistedDesktopShellStateSchema.safeParse(value);
  return parsed.success ? parsed.data : createDefaultDesktopShellState();
}

export function serializeDesktopShellState(state: DesktopShellState): PersistedDesktopShellState {
  return {
    version: 3,
    sidebarOpen: state.sidebarOpen,
    layout: normalizeLayout(state.layout),
    expansionStack: normalizeExpansionStack(
      state.expansionStack,
      state.rightPanel,
      state.bottomPanel,
    ),
    rightPanel: serializeRightPanel(state.rightPanel),
    bottomPanel: serializePanel(state.bottomPanel),
  };
}

function durableBrowserUrl(url: string | null): string | null {
  return url?.startsWith('blob:') ? null : url;
}

function createPersistedShellStateSchema(): z.ZodType<DesktopShellState> {
  const fallback = createDefaultDesktopShellState();
  const rightPanelSchema = createPersistedRightPanelSchema();
  const bottomPanelSchema = createPersistedPanelSchema(false);

  return z
    .object({
      version: z.literal(3),
      sidebarOpen: z.boolean().catch(fallback.sidebarOpen),
      layout: PersistedLayoutSchema,
      expansionStack: PersistedExpansionStackSchema,
      rightPanel: rightPanelSchema,
      bottomPanel: bottomPanelSchema,
    })
    .transform((state) => ({
      sidebarOpen: state.sidebarOpen,
      layout: state.layout,
      rightPanel: state.rightPanel,
      bottomPanel: state.bottomPanel,
      expansionStack: normalizeExpansionStack(
        state.expansionStack,
        state.rightPanel,
        state.bottomPanel,
      ),
    }));
}

function createPersistedPanelSchema(fallbackOpen: boolean): z.ZodType<PanelState> {
  return z
    .object({
      open: z.boolean().catch(fallbackOpen),
      tabs: z
        .array(z.unknown())
        .catch([])
        .transform((items) =>
          items.flatMap((item) => {
            const parsed = NonTerminalPanelWindowTypeSchema.safeParse(item);
            return parsed.success ? [parsed.data] : [];
          }),
        ),
      activeTabIndex: FiniteNumberSchema.int().catch(0),
    })
    .catch({
      open: fallbackOpen,
      tabs: [],
      activeTabIndex: 0,
    })
    .transform(({ open, tabs: parsedTypes, activeTabIndex }) => {
      const tabs = parsedTypes.map((type) => createTab(type));
      const activeIndex = clamp(activeTabIndex, 0, tabs.length - 1);

      return {
        open,
        tabs,
        activeTabId: activeTabIndex === -1 ? null : (tabs[activeIndex]?.id ?? null),
      };
    });
}

function createPersistedRightPanelSchema(): z.ZodType<RightPanelState> {
  const fallback = createDefaultRightPanelState();

  return z
    .object({
      open: z.boolean().catch(fallback.open),
      activeSection: PanelSectionSchema.catch(fallback.activeSection),
      fileTabPaths: z.array(z.string().min(1)).catch([]),
      activeFileTabIndex: FiniteNumberSchema.int().catch(0),
      browserUrl: z.string().min(1).nullable().catch(null),
    })
    .catch({
      open: fallback.open,
      activeSection: fallback.activeSection,
      fileTabPaths: [],
      activeFileTabIndex: 0,
      browserUrl: null,
    })
    .transform(({ open, activeSection, fileTabPaths, activeFileTabIndex, browserUrl }) => {
      const fileTabs = fileTabPaths
        .slice(0, MAX_PERSISTED_RIGHT_FILE_TABS)
        .map((path) => createRightFileTab(path));
      const activeFileIndex =
        fileTabs.length > 0 ? clamp(activeFileTabIndex, 0, fileTabs.length - 1) : 0;
      return {
        open,
        activeSection,
        files: {
          tabs: fileTabs,
          activeTabId: fileTabs.length > 0 ? fileTabs[activeFileIndex].id : null,
        },
        browser: { url: durableBrowserUrl(browserUrl) },
      };
    });
}

function serializeRightPanel(panel: RightPanelState): PersistedRightPanelState {
  return {
    open: panel.open,
    activeSection: panel.activeSection,
    fileTabPaths: panel.files.tabs.map((tab) => tab.path),
    activeFileTabIndex: clamp(
      panel.files.tabs.findIndex((tab) => tab.id === panel.files.activeTabId),
      0,
      Math.max(0, panel.files.tabs.length - 1),
    ),
    browserUrl: durableBrowserUrl(panel.browser.url),
  };
}

function serializePanel(panel: PanelState): PersistedPanelState {
  return {
    open: panel.open,
    tabs: panel.tabs.flatMap((tab) => (tab.type === 'terminal' ? [] : [tab.type])),
    activeTabIndex:
      panel.activeTabId === null
        ? -1
        : clamp(
            panel.tabs.findIndex((tab) => tab.id === panel.activeTabId),
            0,
            Math.max(0, panel.tabs.length - 1),
          ),
  };
}

function isPanelOpen(
  side: PanelSide,
  rightPanel: RightPanelState,
  bottomPanel: PanelState,
): boolean {
  if (side === 'right') return rightPanel.open;
  return bottomPanel.open;
}
