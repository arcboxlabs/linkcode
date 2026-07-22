import { z } from 'zod';

/**
 * Managed assets (CODE-111): platform binaries the daemon downloads, integrity-verifies, and
 * installs into a per-user store. The data contract shared by that store, the engine, and
 * eventually the signed compat manifest (CODE-77), which will carry these shapes with a signature.
 */

/** Agent runtime assets pair a CLI with its in-repo SDK (`agent:pi` is an npm closure the daemon
 * imports in-process, CODE-219). */
export const ManagedAgentAssetIdSchema = z.enum([
  'agent:claude-code',
  'agent:codex',
  'agent:opencode',
  'agent:pi',
]);
export type ManagedAgentAssetId = z.infer<typeof ManagedAgentAssetIdSchema>;

/** Standalone tools managed by the daemon; these may be runtime dependencies of plugins. */
export const ManagedToolAssetIdSchema = z.enum(['tool:tectonic', 'tool:aigateway']);
export type ManagedToolAssetId = z.infer<typeof ManagedToolAssetIdSchema>;

/** Every asset understood by the managed-asset store and wire control surface. */
export const ManagedAssetIdSchema = z.enum([
  ...ManagedAgentAssetIdSchema.options,
  ...ManagedToolAssetIdSchema.options,
]);
export type ManagedAssetId = z.infer<typeof ManagedAssetIdSchema>;

export const ManagedAssetFormatSchema = z.enum(['tgz', 'zip', 'raw']);
export type ManagedAssetFormat = z.infer<typeof ManagedAssetFormatSchema>;

/** A fully resolved downloadable artifact: one asset version on one platform. `urls` is an
 * ordered source list; `integrity` pins the exact bytes, so the downloader walks the list until
 * one delivers verified content (mirror/fallback with no trust implications). */
export const ManagedAssetArtifactSchema = z.object({
  urls: z.array(z.string().min(1)).min(1),
  /** SRI string (e.g. `sha512-<base64>`; whitespace-separated multi-hash allowed). */
  integrity: z.string().min(1),
  /** Compressed size in bytes when known; drives download progress display. */
  size: z.number().int().positive().optional(),
  format: ManagedAssetFormatSchema,
  /** Archive member holding the executable (e.g. `package/claude`); absent for `raw`. */
  member: z.string().optional(),
  /**
   * Additional archive members installed as siblings of the executable under their basenames
   * (e.g. codex's Windows sandbox helpers, which the CLI resolves next to its own binary).
   */
  extraMembers: z.array(z.string().min(1)).optional(),
});
export type ManagedAssetArtifact = z.infer<typeof ManagedAssetArtifactSchema>;

/** An asset version present in the local store, ready to spawn. */
export const InstalledAssetSchema = z.object({
  id: ManagedAssetIdSchema,
  version: z.string().min(1),
  /** Absolute path of the installed executable. */
  path: z.string().min(1),
});
export type InstalledAsset = z.infer<typeof InstalledAssetSchema>;

/** Per-asset status served on `asset.listed`; installs are triggered via `asset.ensure`. */
export const ManagedAssetStatusSchema = z.object({
  id: ManagedAssetIdSchema,
  /** The version this host wants; absent when the pin cannot be determined (SDK missing). */
  wantedVersion: z.string().optional(),
  /** Present when the wanted version is installed and spawnable. */
  installed: InstalledAssetSchema.optional(),
});
export type ManagedAssetStatus = z.infer<typeof ManagedAssetStatusSchema>;

/** Install lifecycle the asset store fans out to observers (forwarded by the engine as the
 * `asset.progress` / `asset.settled` broadcasts). In-process contract, not a wire shape. */
export type AssetInstallEvent =
  | { kind: 'progress'; id: ManagedAssetId; receivedBytes: number; totalBytes?: number }
  | { kind: 'installed'; id: ManagedAssetId; installed: InstalledAsset }
  | { kind: 'failed'; id: ManagedAssetId; error: string };
