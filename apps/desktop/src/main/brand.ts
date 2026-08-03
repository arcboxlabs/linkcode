import type { BrandIdentityArtifact } from '@linkcode/common/config';
import { parseBrandIdentityArtifact } from '@linkcode/common/config';
import type { ProductChannel } from '@linkcode/schema/daemon-runtime';

/**
 * The build-time brand identity (CODE-558): rendered by the pinned config publisher, inlined by
 * vite.main.config.ts as MAIN_VITE_BRAND_IDENTITY next to the config bootstrap. No identity means
 * the default LinkCode build; a present-but-invalid identity aborts boot instead of falling back,
 * so a tampered or stale artifact can never ship under the wrong brand.
 */
export function parseDesktopBrandIdentity(raw: string | undefined): BrandIdentityArtifact | null {
  if (raw === undefined || raw === '') return null;
  const identity = parseBrandIdentityArtifact(JSON.parse(raw));
  if (identity.platform !== 'desktop') {
    throw new Error(`brand identity targets ${identity.platform}, not desktop`);
  }
  return identity;
}

/** OS-facing base identity before profile suffixing (see constants.ts). */
export interface DesktopBrandBase {
  readonly appId: string;
  readonly appName: string;
  readonly authScheme: string;
  readonly storageDirName: string;
}

/**
 * Applies the client-side development-channel decoration on top of the publisher-rendered
 * identity. The publisher already decorated the product channel (canary/stable); the development
 * axis is purely local (dev shells, unpackaged runs) and must keep the same isolation rationale
 * as the default brand: a development build never clobbers the installed release's settings,
 * instance lock, or OS-global URL scheme.
 */
export function deriveDesktopBrandBase(
  identity: BrandIdentityArtifact,
  channel: ProductChannel,
): DesktopBrandBase {
  const development = channel === 'development';
  return {
    appId: development ? `${identity.applicationId}.development` : identity.applicationId,
    appName: development ? `${identity.displayName} Development` : identity.displayName,
    authScheme: development ? `${identity.urlScheme}-dev` : identity.urlScheme,
    storageDirName: development
      ? `${identity.storageNamespace} Development`
      : identity.storageNamespace,
  };
}
