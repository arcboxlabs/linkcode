import { create } from 'zustand';
import type { PaletteCommand } from './match';

interface CommandPaletteState {
  open: boolean;
  /** App-registered commands keyed by owner, so an unmounting surface only removes its own. */
  commandsByOwner: Record<string, readonly PaletteCommand[]>;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  registerCommands: (owner: string, commands: readonly PaletteCommand[]) => void;
  unregisterCommands: (owner: string) => void;
}

/**
 * Command-palette state shared across the whole client. Lives at module scope (not in the
 * `Workbench` tree) so app edges — the desktop shell, webview routes — can open the palette and
 * register their own commands without threading props through the surface. Not persisted.
 */
export const useCommandPaletteStore = create<CommandPaletteState>()((set) => ({
  open: false,
  commandsByOwner: {},
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
  registerCommands: (owner, commands) =>
    set((state) => ({ commandsByOwner: { ...state.commandsByOwner, [owner]: commands } })),
  unregisterCommands: (owner) =>
    set((state) => ({
      commandsByOwner: Object.fromEntries(
        Object.entries(state.commandsByOwner).filter(([key]) => key !== owner),
      ),
    })),
}));

/** Imperative open, for click triggers (e.g. the sidebar Search entry). */
export function openCommandPalette(): void {
  useCommandPaletteStore.getState().setOpen(true);
}
