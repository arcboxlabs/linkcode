/**
 * Managed-asset failure taxonomy. Everything derives from `AssetError` so daemon boot and
 * session-start paths can degrade (fall back to detected/SDK resolution) in one catch arm;
 * the subclasses exist for log/telemetry granularity, not divergent recovery.
 */
export class AssetError extends Error {
  override name = 'AssetError';
}

/** Every download source failed, or a fatal condition (e.g. ENOSPC) aborted the source walk. */
export class DownloadError extends AssetError {
  override name = 'DownloadError';
}

/** Downloaded bytes did not match the pinned SRI digest. */
export class IntegrityError extends AssetError {
  override name = 'IntegrityError';
}

/** Archive extraction failed: corrupt archive or missing member. */
export class ExtractError extends AssetError {
  override name = 'ExtractError';
}

/** The host cannot run the asset pipeline at all (e.g. no system `tar`). */
export class UnsupportedPlatformError extends AssetError {
  override name = 'UnsupportedPlatformError';
}
