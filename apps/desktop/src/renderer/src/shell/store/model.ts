import type {
  PanelSection,
  PanelSectionTab,
  PanelSide,
  PanelTab,
  PanelWindowType,
} from '@linkcode/ui/shell/panels';
import { PANEL_SECTIONS, PANEL_WINDOW_TYPES } from '@linkcode/ui/shell/panels';
import { clamp } from 'foxts/clamp';
import { createFixedArray } from 'foxts/create-fixed-array';
import { z } from 'zod';

export type { PanelSide } from '@linkcode/ui/shell/panels';
export type PanelExpansionTarget = 'editor-row' | 'workbench';

export interface PanelState {
  open: boolean;
  tabs: PanelTab[];
  activeTabId: string | null;
}

/** The right panel's terminal section: its own sub-tab strip of PTY instances. */
export interface RightPanelTerminalState {
  tabs: PanelSectionTab[];
  activeTabId: string | null;
}

/** One open file in the right panel's files section. */
export interface FileSectionTab extends PanelSectionTab {
  path: string;
}

/** The right panel's files section: viewer sub-tabs for files opened from chat. */
export interface RightPanelFilesState {
  tabs: FileSectionTab[];
  activeTabId: string | null;
}

/** One open page in the right panel's browser section (its own Electron webview). */
export interface BrowserSectionTab extends PanelSectionTab {
  url: string | null;
  /** Last title reported by the page; null falls back to an index-derived label. */
  title: string | null;
}

/** The right panel's in-app browser: webview sub-tabs, mirroring the terminal section. */
export interface RightPanelBrowserState {
  tabs: BrowserSectionTab[];
  activeTabId: string | null;
}

/** The right panel: fixed Diff/Terminal/Browser/Files sections, with per-instance
 * sub-tabs for Terminal (PTYs), Browser (webviews), and Files (viewers). */
export interface RightPanelState {
  open: boolean;
  activeSection: PanelSection;
  terminal: RightPanelTerminalState;
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
  terminalTabCount: number;
  activeTerminalTabIndex: number;
  fileTabPaths: string[];
  activeFileTabIndex: number;
  /** Null entries are empty tabs, kept so activeBrowserTabIndex stays aligned. */
  browserTabUrls: Array<string | null>;
  activeBrowserTabIndex: number;
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

/** The bottom panel's window type when it needs to seed a first tab. */
const DEFAULT_BOTTOM_WINDOW_TYPE: PanelWindowType = 'terminal';

/** Defensive cap on the terminal tab count restored from persisted state. */
const MAX_PERSISTED_RIGHT_TERMINAL_TABS = 20;

/** Defensive cap on the file tab count restored from persisted state. */
const MAX_PERSISTED_RIGHT_FILE_TABS = 20;

/** Defensive cap on the browser tab count restored from persisted state. */
const MAX_PERSISTED_RIGHT_BROWSER_TABS = 20;

let tabSequence = 0;

const PanelSideSchema = z.enum(['right', 'bottom']);
const PanelSectionSchema = z.enum(PANEL_SECTIONS);
const PanelWindowTypeSchema = z.enum(PANEL_WINDOW_TYPES);
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
    bottomPanel: createPanelState(false, DEFAULT_BOTTOM_WINDOW_TYPE),
  };
}

export function createDefaultRightPanelState(): RightPanelState {
  return {
    open: false,
    activeSection: 'diff',
    terminal: { tabs: [], activeTabId: null },
    files: { tabs: [], activeTabId: null },
    browser: { tabs: [], activeTabId: null },
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

/** Prefixed so ids never collide with the bottom panel's tabs, which share the same PTY registry. */
export function createRightTerminalTab(): PanelSectionTab {
  tabSequence += 1;
  return { id: `right-terminal-${tabSequence}` };
}

/** The terminal section never comes forward empty: seed a first PTY tab (same as pressing +). */
export function seedTerminalSection(terminal: RightPanelTerminalState): RightPanelTerminalState {
  if (terminal.tabs.length > 0) return terminal;
  const tab = createRightTerminalTab();
  return { tabs: [tab], activeTabId: tab.id };
}

/** Brings `section` forward, seeding sections that must never become visible without a tab. */
export function revealSectionState(
  panel: RightPanelState,
  section: PanelSection,
  open: boolean,
): RightPanelState {
  const revealed = {
    ...panel,
    open,
    activeSection: section,
    terminal: open && section === 'terminal' ? seedTerminalSection(panel.terminal) : panel.terminal,
  };
  return open ? seedBrowserSection(revealed) : revealed;
}

export function createRightFileTab(path: string): FileSectionTab {
  tabSequence += 1;
  return { id: `right-file-${tabSequence}`, path };
}

export function createRightBrowserTab(url: string | null = null): BrowserSectionTab {
  tabSequence += 1;
  return { id: `right-browser-${tabSequence}`, url, title: null };
}

/** Removes a section sub-tab, falling back the active tab to a neighbor if it was the one closed. */
export function closeSectionTabState<Tab extends PanelSectionTab>(
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

/** Navigates the active browser tab (title resets until the page reports one), or seeds a first tab. */
export function openBrowserUrlState(
  browser: RightPanelBrowserState,
  url: string,
): RightPanelBrowserState {
  const active = browser.tabs.find((tab) => tab.id === browser.activeTabId);
  if (active) return updateBrowserTabState(browser, active.id, { url, title: null });
  const tab = createRightBrowserTab(url);
  return { tabs: [...browser.tabs, tab], activeTabId: tab.id };
}

/** The browser section always activates with at least one (possibly empty) tab. */
export function seedBrowserSection(panel: RightPanelState): RightPanelState {
  if (panel.activeSection !== 'browser' || panel.browser.tabs.length > 0) return panel;
  const tab = createRightBrowserTab();
  return { ...panel, browser: { tabs: [tab], activeTabId: tab.id } };
}

export function updateBrowserTabState(
  browser: RightPanelBrowserState,
  tabId: string,
  patch: Partial<Pick<BrowserSectionTab, 'url' | 'title'>>,
): RightPanelBrowserState {
  if (!browser.tabs.some((tab) => tab.id === tabId)) return browser;
  return {
    ...browser,
    tabs: browser.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)),
  };
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
  const bottomPanelSchema = createPersistedPanelSchema(DEFAULT_BOTTOM_WINDOW_TYPE, false);

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

function createPersistedPanelSchema(
  fallbackType: PanelWindowType,
  fallbackOpen: boolean,
): z.ZodType<PanelState> {
  return z
    .object({
      open: z.boolean().catch(fallbackOpen),
      tabs: z
        .array(z.unknown())
        .catch([])
        .transform((items) =>
          items.flatMap((item) => {
            const parsed = PanelWindowTypeSchema.safeParse(item);
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
      const types = parsedTypes.length > 0 ? parsedTypes : [fallbackType];
      const tabs = types.map((type) => createTab(type));
      const activeIndex = clamp(activeTabIndex, 0, tabs.length - 1);

      return {
        open,
        tabs,
        activeTabId: tabs[activeIndex].id,
      };
    });
}

function createPersistedRightPanelSchema(): z.ZodType<RightPanelState> {
  const fallback = createDefaultRightPanelState();

  return z
    .object({
      open: z.boolean().catch(fallback.open),
      activeSection: PanelSectionSchema.catch(fallback.activeSection),
      terminalTabCount: FiniteNumberSchema.int().nonnegative().catch(0),
      activeTerminalTabIndex: FiniteNumberSchema.int().catch(0),
      // Absent in pre-files persisted payloads; the catches make the section start empty.
      fileTabPaths: z.array(z.string().min(1)).catch([]),
      activeFileTabIndex: FiniteNumberSchema.int().catch(0),
      browserTabUrls: z.array(z.string().min(1).nullable()).catch([]),
      activeBrowserTabIndex: FiniteNumberSchema.int().catch(0),
    })
    .catch({
      open: fallback.open,
      activeSection: fallback.activeSection,
      terminalTabCount: 0,
      activeTerminalTabIndex: 0,
      fileTabPaths: [],
      activeFileTabIndex: 0,
      browserTabUrls: [],
      activeBrowserTabIndex: 0,
    })
    .transform(
      ({
        open,
        activeSection,
        terminalTabCount,
        activeTerminalTabIndex,
        fileTabPaths,
        activeFileTabIndex,
        browserTabUrls,
        activeBrowserTabIndex,
      }) => {
        const tabCount = clamp(terminalTabCount, 0, MAX_PERSISTED_RIGHT_TERMINAL_TABS);
        const tabs = createFixedArray(tabCount).map(() => createRightTerminalTab());
        const activeIndex = tabs.length > 0 ? clamp(activeTerminalTabIndex, 0, tabs.length - 1) : 0;
        const fileTabs = fileTabPaths
          .slice(0, MAX_PERSISTED_RIGHT_FILE_TABS)
          .map((path) => createRightFileTab(path));
        const activeFileIndex =
          fileTabs.length > 0 ? clamp(activeFileTabIndex, 0, fileTabs.length - 1) : 0;
        const terminal = {
          tabs,
          activeTabId: tabs.length > 0 ? tabs[activeIndex].id : null,
        };
        const browserTabs = browserTabUrls
          .slice(0, MAX_PERSISTED_RIGHT_BROWSER_TABS)
          .map((url) => createRightBrowserTab(durableBrowserUrl(url)));
        const activeBrowserIndex =
          browserTabs.length > 0 ? clamp(activeBrowserTabIndex, 0, browserTabs.length - 1) : 0;

        return {
          open,
          activeSection,
          terminal: open && activeSection === 'terminal' ? seedTerminalSection(terminal) : terminal,
          files: {
            tabs: fileTabs,
            activeTabId: fileTabs.length > 0 ? fileTabs[activeFileIndex].id : null,
          },
          browser: {
            tabs: browserTabs,
            activeTabId: browserTabs.length > 0 ? browserTabs[activeBrowserIndex].id : null,
          },
        };
      },
    );
}

function serializeRightPanel(panel: RightPanelState): PersistedRightPanelState {
  return {
    open: panel.open,
    activeSection: panel.activeSection,
    terminalTabCount: panel.terminal.tabs.length,
    activeTerminalTabIndex: clamp(
      panel.terminal.tabs.findIndex((tab) => tab.id === panel.terminal.activeTabId),
      0,
      Math.max(0, panel.terminal.tabs.length - 1),
    ),
    fileTabPaths: panel.files.tabs.map((tab) => tab.path),
    activeFileTabIndex: clamp(
      panel.files.tabs.findIndex((tab) => tab.id === panel.files.activeTabId),
      0,
      Math.max(0, panel.files.tabs.length - 1),
    ),
    browserTabUrls: panel.browser.tabs.map((tab) => durableBrowserUrl(tab.url)),
    activeBrowserTabIndex: clamp(
      panel.browser.tabs.findIndex((tab) => tab.id === panel.browser.activeTabId),
      0,
      Math.max(0, panel.browser.tabs.length - 1),
    ),
  };
}

function serializePanel(panel: PanelState): PersistedPanelState {
  return {
    open: panel.open,
    tabs: panel.tabs.map((tab) => tab.type),
    activeTabIndex: clamp(
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
