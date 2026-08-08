import type { BrandIdentityArtifact } from '@linkcode/common/config';

/**
 * Derives the electron-builder overlay for one rendered brand identity. Identity-owned fields
 * only — everything else (files, publish feed, targets) stays in the shared electron-builder.yml
 * base this overlay extends. Never write these fields by hand for a branded build.
 */
export interface ElectronBuilderBrandConfig {
  readonly appId: string;
  readonly extends: string;
  readonly linux: { readonly executableName: string; readonly icon: string };
  readonly mac: { readonly icon: string };
  readonly productName: string;
  readonly protocols: readonly [{ readonly name: string; readonly schemes: readonly [string] }];
  /** Always null: the base config's update feed belongs to the default product. A branded
   * artifact must never auto-update from another brand's feed; per-brand feeds are release
   * orchestration (CODE-559), not identity. */
  readonly publish: null;
  readonly win: { readonly icon: string };
}

/** Staged brand icon, relative to apps/desktop (the generated config lives in generated/). */
export const BRAND_ICON_PATH = 'generated/brand-assets/icon.png';

export function electronBuilderBrandConfig(
  identity: BrandIdentityArtifact,
): ElectronBuilderBrandConfig {
  if (identity.platform !== 'desktop') {
    throw new Error(`electron-builder config requires a desktop identity, got ${identity.platform}`);
  }
  return {
    appId: identity.applicationId,
    // app-builder-lib resolves `extends` against the PROJECT dir, not the config file: that is
    // apps/desktop when packing in place and the staging root under package-app.mts (the deploy
    // copies electron-builder.yml there) — both hold the base config at ./electron-builder.yml.
    extends: './electron-builder.yml',
    // The base names the executable after the default product; the brand id is the stable,
    // filesystem-safe brand analog (process name and .desktop wmclass are user-visible).
    linux: { executableName: identity.brandId, icon: BRAND_ICON_PATH },
    mac: { icon: BRAND_ICON_PATH },
    productName: identity.displayName,
    protocols: [{ name: identity.displayName, schemes: [identity.urlScheme] }],
    publish: null,
    win: { icon: BRAND_ICON_PATH },
  };
}

/** Deterministic bytes: two-space indent, lexicographically sorted keys, trailing newline —
 * the same serialization contract as the publisher's identity artifact. */
export function serializeElectronBuilderBrandConfig(config: ElectronBuilderBrandConfig): string {
  return `${JSON.stringify(sortedJson(config), null, 2)}\n`;
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortedJson(entry));
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortedJson(record[key])]),
    );
  }
  return value;
}
