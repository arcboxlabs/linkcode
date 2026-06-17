/** System-plane bridge the desktop shell passes in for window controls (never carries business data). */
export interface WorkbenchSystemBridge {
  window?: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
  };
}
