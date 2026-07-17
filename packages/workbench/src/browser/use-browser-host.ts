import type { BrowserCommandExecutor } from '@linkcode/client-core';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { noop } from 'foxts/noop';
import { useWorkbenchSdkClient } from '../runtime/provider';

/**
 * Registers this client as the daemon's browser host while an executor is supplied (desktop
 * passes its webview-backed executor; webview/mobile pass nothing and never register). Mounted
 * under the connection gate, so a reconnect generation remounts it and re-registers.
 */
export function useBrowserHostRegistration(executor: BrowserCommandExecutor | null): void {
  const client = useWorkbenchSdkClient();
  useAbortableEffect(() => {
    if (executor === null) return;
    // Registration failure just leaves agent browser tools reporting host-unavailable.
    void client.raw.registerBrowserHost(executor).catch(noop);
  }, [client, executor]);
}
