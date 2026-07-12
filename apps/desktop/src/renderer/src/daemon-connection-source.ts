import type { WorkbenchConnectionSource } from '@linkcode/workbench';
import { createDaemonTransport } from '@linkcode/workbench';
import { systemBridge } from './ipc';
import { useDesktopSettingsStore } from './settings/store';

/** Desktop system-plane inputs for the Workbench-owned data-plane connection lifecycle. */
export const desktopDaemonConnectionSource: WorkbenchConnectionSource = {
  resolve() {
    const endpoint = systemBridge.daemon.resolveUrl();
    return { endpoint, transport: createDaemonTransport(endpoint) };
  },

  subscribe(invalidate) {
    const offRuntime = systemBridge.daemon.onRuntimeChanged(() => {
      if (useDesktopSettingsStore.getState().daemonUrlOverride === null) invalidate();
    });
    const offSettings = useDesktopSettingsStore.subscribe((state, previous) => {
      if (state.daemonUrlOverride !== previous.daemonUrlOverride) invalidate();
    });

    return () => {
      offRuntime();
      offSettings();
    };
  },

  onExplicitRetry: () => systemBridge.daemon.retry(),
};
