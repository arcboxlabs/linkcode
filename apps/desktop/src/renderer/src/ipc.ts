import type { SystemBridge } from '@linkcode/ipc';

declare global {
  interface Window {
    linkcodeSystem: SystemBridge;
  }
}

export const systemBridge = window.linkcodeSystem;
