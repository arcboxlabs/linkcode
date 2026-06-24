/** System-plane bridge the desktop shell passes in for window controls (never carries business data). */
export interface WorkbenchPickFileOptions {
  title?: string;
  directory?: boolean;
}

export interface WorkbenchSystemBridge {
  window?: {
    minimize: () => Promise<void> | void;
    toggleMaximize: () => Promise<void> | void;
    close: () => Promise<void> | void;
    isMaximized?: () => Promise<boolean>;
    onMaximizedChange?: (cb: (value: boolean) => void) => () => void;
  };
  fs?: {
    pickFile?: (opts?: WorkbenchPickFileOptions) => Promise<string | null>;
  };
  app?: {
    version?: () => Promise<string>;
    platform?: () => Promise<string>;
  };
}
