import type { WorkbenchConnectionSource } from '@linkcode/workbench';
import { createDaemonTransport } from '@linkcode/workbench';
import { useSettingsStore } from './settings/store';

/** Browser settings input for the Workbench-owned data-plane connection lifecycle. */
export const webviewDaemonConnectionSource: WorkbenchConnectionSource = {
  resolve() {
    const endpoint = useSettingsStore.getState().daemonUrl;
    return { endpoint, transport: createDaemonTransport(endpoint) };
  },

  subscribe(invalidate) {
    return useSettingsStore.subscribe((state, previous) => {
      if (state.daemonUrl !== previous.daemonUrl) invalidate();
    });
  },
};
