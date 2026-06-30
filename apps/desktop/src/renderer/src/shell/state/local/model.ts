import { PANEL_WINDOW_TYPES } from '@linkcode/ui';
import type { PanelTab, PanelWindowType } from '@linkcode/ui';
import { z } from 'zod';

export type PanelSide = 'right' | 'bottom';
export type PanelExpansionTarget = 'editor-row' | 'workbench';

export interface PanelState {
  open: boolean;
  tabs: PanelTab[];
  activeTabId: string | null;
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
  rightPanel: PanelState;
  bottomPanel: PanelState;
}

export interface PersistedDesktopShellState {
  version: 1;
  sidebarOpen: boolean;
  layout: LayoutState;
  expansionStack: PanelSide[];
  rightPanel: PersistedPanelState;
  bottomPanel: PersistedPanelState;
}

export interface PersistedPanelState {
  open: boolean;
  tabs: PanelWindowType[];
  activeTabIndex: number;
}

export interface DesktopShellStateModel {
  storageKey: string;
  createDefault: () => DesktopShellState;
  parse: (value: unknown) => DesktopShellState;
  serialize: (state: DesktopShellState) => PersistedDesktopShellState;
}

export const DESKTOP_SHELL_STORAGE_KEY = 'linkcode.desktop.shell-state:v1';

export const SIDEBAR_MIN_SIZE = 240;
export const SIDEBAR_MAX_SIZE = 520;
export const RIGHT_PANEL_MIN_SIZE = 320;
export const RIGHT_PANEL_MAX_SIZE = 820;
export const BOTTOM_PANEL_MIN_SIZE = 150;
export const BOTTOM_PANEL_MAX_SIZE = 560;
export const MIN_MAIN_SIZE = 360;

export const DEFAULT_LAYOUT: LayoutState = {
  sidebarW: 286,
  rightW: 440,
  bottomH: 230,
};

export const PANEL_EXPANSION_TARGET: Record<PanelSide, PanelExpansionTarget> = {
  right: 'editor-row',
  bottom: 'workbench',
};

let tabSequence = 0;

const PanelSideSchema = z.enum(['right', 'bottom']);
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
    rightPanel: createPanelState(false, 'review'),
    bottomPanel: createPanelState(false, 'terminal'),
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

export function defaultWindowFor(side: PanelSide): PanelWindowType {
  return side === 'right' ? 'review' : 'terminal';
}

export function getPanelFromShellState(state: DesktopShellState, side: PanelSide): PanelState {
  return side === 'right' ? state.rightPanel : state.bottomPanel;
}

export function setPanelInShellState(
  state: DesktopShellState,
  side: PanelSide,
  panel: PanelState,
): DesktopShellState {
  if (side === 'right') return { ...state, rightPanel: panel };
  return { ...state, bottomPanel: panel };
}

export function pushExpandedPanel(stack: PanelSide[], side: PanelSide): PanelSide[] {
  return [...removeExpandedPanel(stack, side), side];
}

export function removeExpandedPanel(stack: PanelSide[], side: PanelSide): PanelSide[] {
  return stack.filter((item) => item !== side);
}

export function normalizeExpansionStack(
  value: PanelSide[],
  rightPanel: PanelState,
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

export const desktopShellStateModel = {
  storageKey: DESKTOP_SHELL_STORAGE_KEY,
  createDefault: createDefaultDesktopShellState,
  parse: parseDesktopShellState,
  serialize: serializeDesktopShellState,
} satisfies DesktopShellStateModel;

function parseDesktopShellState(value: unknown): DesktopShellState {
  const parsed = createPersistedShellStateSchema().safeParse(value);
  return parsed.success ? parsed.data : createDefaultDesktopShellState();
}

function serializeDesktopShellState(state: DesktopShellState): PersistedDesktopShellState {
  return {
    version: 1,
    sidebarOpen: state.sidebarOpen,
    layout: normalizeLayout(state.layout),
    expansionStack: normalizeExpansionStack(
      state.expansionStack,
      state.rightPanel,
      state.bottomPanel,
    ),
    rightPanel: serializePanel(state.rightPanel),
    bottomPanel: serializePanel(state.bottomPanel),
  };
}

function createPersistedShellStateSchema(): z.ZodType<DesktopShellState> {
  const fallback = createDefaultDesktopShellState();
  const rightPanelSchema = createPersistedPanelSchema('review', false);
  const bottomPanelSchema = createPersistedPanelSchema('terminal', false);

  return z
    .object({
      version: z.literal(1),
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
  rightPanel: PanelState,
  bottomPanel: PanelState,
): side is PanelSide {
  if (side === 'right') return rightPanel.open;
  return bottomPanel.open;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
