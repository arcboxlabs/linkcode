import type {
  DesktopSettings,
  DesktopSettingsPatch,
  PickFileOptions,
  SystemNotification,
  UpdaterStatus,
} from './context';

/**
 * SystemBridge: the capability contract of TypeSafe IPC (docs/ARCHITECTURE.md#key-contracts) —
 * system / UI capabilities only. Business data always goes through the transport and is
 * **forbidden from this channel** (docs/ARCHITECTURE.md#core-principles).
 */
export interface SystemBridge {
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    /** Subscribe to maximize/restore/full-screen changes pushed from main — drives the restore icon. */
    onMaximizedChange(cb: (value: boolean) => void): () => void;
  };
  fs: {
    pickFile(opts?: PickFileOptions): Promise<string | null>;
  };
  app: {
    version(): Promise<string>;
    platform(): Promise<NodeJS.Platform>;
    /** Trigger a manual update check; observe progress via `onUpdaterStatus`. */
    checkForUpdates(): Promise<void>;
    /** Subscribe to auto-update lifecycle status pushed from main. */
    onUpdaterStatus(cb: (status: UpdaterStatus) => void): () => void;
    /** Subscribe to the menubar/Cmd+, "open settings" push from main. */
    onOpenSettings(cb: () => void): () => void;
  };
  settings: {
    get(): Promise<DesktopSettings>;
    set(patch: DesktopSettingsPatch): Promise<DesktopSettings>;
    /** Synchronous boot snapshot — safe to read during first render. */
    snapshot(): DesktopSettings;
  };
  daemon: {
    /**
     * Effective daemon endpoint (explicit setting ?? runtime-file discovery ?? default).
     * Synchronous — safe to read during first render.
     */
    resolveUrl(): string;
    /**
     * Whether this app supervises the daemon's lifecycle (packaged build, no endpoint override).
     * Drives the connection-failure copy: a managed host restarts itself, an unmanaged one is the
     * user's to run.
     */
    isManaged(): Promise<boolean>;
    /**
     * Subscribe to daemon runtime-file changes pushed from main (fs.watch on ~/.linkcode).
     * Fired when a daemon (re)starts or stops — re-run `resolveUrl` on it.
     */
    onRuntimeChanged(cb: () => void): () => void;
  };
  notifications: {
    /** Show an OS notification (main-process `Notification`); display params only. */
    notify(notification: SystemNotification): Promise<void>;
    /** Subscribe to notification clicks; main focuses the window, then pushes the `clickToken`. */
    onClick(cb: (clickToken: string) => void): () => void;
  };
}
