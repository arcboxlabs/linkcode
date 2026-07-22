import type { McpPluginId, McpPluginService } from '@linkcode/schema';
import { create } from 'zustand';

export type PluginSettingsDialog =
  | { kind: 'closed' }
  | { kind: 'add'; service: McpPluginService; enableUnitId?: McpPluginId }
  | { kind: 'edit'; connectorId: string }
  | { kind: 'remove'; connectorId: string };

interface PluginSettingsViewState {
  dialog: PluginSettingsDialog;
  addConnection: (service: McpPluginService, enableUnitId?: McpPluginId) => void;
  editConnection: (connectorId: string) => void;
  removeConnection: (connectorId: string) => void;
  closeDialog: () => void;
}

/** Ephemeral dialog state; daemon config remains the only persisted plugin state. */
export const usePluginSettingsViewStore = create<PluginSettingsViewState>()((set) => ({
  dialog: { kind: 'closed' },
  addConnection: (service, enableUnitId) =>
    set({
      dialog: {
        kind: 'add',
        service,
        ...(enableUnitId !== undefined && { enableUnitId }),
      },
    }),
  editConnection: (connectorId) => set({ dialog: { kind: 'edit', connectorId } }),
  removeConnection: (connectorId) => set({ dialog: { kind: 'remove', connectorId } }),
  closeDialog: () => set({ dialog: { kind: 'closed' } }),
}));
