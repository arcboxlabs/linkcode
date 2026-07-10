import { z } from 'zod';

/**
 * System IPC carries only system / UI capabilities and never carries business data
 * (docs/ARCHITECTURE.md#core-principles, #packages--repo-layout).
 * SystemContext is the injection point for the implementation of these capabilities: the Electron main
 * process provides the real implementation, while the shared contract stays business-free.
 */
export interface SystemContext {
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): boolean;
  };
  dialog: {
    pickFile(opts?: PickFileOptions): Promise<string | null>;
  };
  app: {
    getVersion(): string;
    getPlatform(): NodeJS.Platform;
    /** Trigger a manual update check (no-op when the app is not packaged). */
    checkForUpdates(): void;
  };
  settings: {
    get(): DesktopSettings;
    set(patch: DesktopSettingsPatch): DesktopSettings;
  };
  daemon: {
    /** Effective daemon endpoint: explicit setting, else runtime-file discovery, else default. */
    resolveUrl(): string;
    /** Whether this app supervises the daemon's lifecycle (packaged build, no endpoint override). */
    isManaged(): boolean;
    /** Re-arm the managed daemon after an explicit connection retry; no-op when unmanaged. */
    retry(): void;
  };
  notifications: {
    /** Show an OS notification; a click focuses the window and pushes `clickToken` back. */
    notify(notification: SystemNotification): void;
  };
}

export const PickFileOptionsSchema = z.object({
  title: z.string().optional(),
  /** Whether to select a directory rather than a file. */
  directory: z.boolean().optional(),
});
export type PickFileOptions = z.infer<typeof PickFileOptionsSchema>;

/**
 * Display parameters for one OS notification — a native-UI operation, not a data channel. The
 * renderer decides whether/what to notify; `clickToken` is opaque to this layer and is echoed
 * back verbatim on click so the renderer can route (e.g. select the matching session).
 */
export const SystemNotificationSchema = z.object({
  title: z.string(),
  body: z.string(),
  clickToken: z.string(),
});
export type SystemNotification = z.infer<typeof SystemNotificationSchema>;

/** Renderer color-scheme preference; `system` follows the OS via `nativeTheme.themeSource`. */
export const ThemePreferenceSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

/**
 * System-plane desktop settings — color scheme, locale override, and the daemon endpoint the
 * renderer dials. Carries no business data; persisted by the main process under `userData`.
 */
export const DesktopSettingsSchema = z.object({
  theme: ThemePreferenceSchema.default('system'),
  /** Locale override; `null` follows the OS (navigator.languages). */
  locale: z.string().nullable().default(null),
  /** Explicit daemon endpoint override; `null` discovers the local daemon (runtime file, then default port). */
  daemonUrl: z.url().nullable().default(null),
});
export type DesktopSettings = z.infer<typeof DesktopSettingsSchema>;

/**
 * A settings patch — every field optional, **no defaults** so absent keys are left untouched
 * (a `DesktopSettingsSchema.partial()` would re-inject defaults and clobber the stored values).
 */
export const DesktopSettingsPatchSchema = z.object({
  theme: ThemePreferenceSchema.optional(),
  locale: z.string().nullable().optional(),
  daemonUrl: z.url().nullable().optional(),
});
export type DesktopSettingsPatch = z.infer<typeof DesktopSettingsPatchSchema>;

/** Auto-update lifecycle state surfaced to the renderer (no business data). */
export const UpdaterStatusSchema = z.enum([
  'idle',
  'checking',
  'available',
  'not-available',
  'downloading',
  'downloaded',
  'error',
]);
export type UpdaterStatus = z.infer<typeof UpdaterStatusSchema>;
