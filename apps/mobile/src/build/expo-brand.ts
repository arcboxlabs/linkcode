// Build-time only (config:render + app.config.ts): derives the Expo brand overlay from the two
// rendered mobile identity artifacts and applies it to the static app.json base. Never imported
// by runtime code — native identity is fixed at prebuild and must not be re-derived on device.
import type { BrandIdentityArtifact } from '@linkcode/common/config';
import type { ExpoConfig } from 'expo/config';

/** One overlay for both mobile platforms: the shared fields must agree across the ios and
 * android artifacts (same manifest render), while each platform keeps its own application id. */
export interface ExpoBrandOverlay {
  readonly androidPackage: string;
  readonly brandId: string;
  readonly channel: string;
  readonly displayName: string;
  readonly iosBundleIdentifier: string;
  readonly sourceGitSha: string;
  readonly urlScheme: string;
}

/** Staged brand icon, relative to apps/mobile (where app.config.ts resolves asset paths). */
export const MOBILE_BRAND_ICON_PATH = './generated/brand-assets/icon.png';

function fail(message: string): never {
  throw new Error(message);
}

function requireEqual(field: string, ios: unknown, android: unknown): void {
  if (ios !== android) {
    fail(
      `brand identity ${field} differs between ios (${String(ios)}) and android ` +
        `(${String(android)}); both artifacts must come from one manifest render`,
    );
  }
}

/** Collapses the two platform identities into one overlay, failing closed on any disagreement —
 * mixed-render artifacts must never produce a build that is one brand on iOS and another on
 * Android. */
export function deriveExpoBrandOverlay(
  ios: BrandIdentityArtifact,
  android: BrandIdentityArtifact,
): ExpoBrandOverlay {
  if (ios.platform !== 'ios') fail(`expected an ios identity, got ${ios.platform}`);
  if (android.platform !== 'android') {
    fail(`expected an android identity, got ${android.platform}`);
  }
  requireEqual('brandId', ios.brandId, android.brandId);
  requireEqual('channel', ios.channel, android.channel);
  requireEqual('displayName', ios.displayName, android.displayName);
  requireEqual('urlScheme', ios.urlScheme, android.urlScheme);
  requireEqual('assetsPath', ios.assetsPath, android.assetsPath);
  requireEqual(
    'provenance.sourceGitSha',
    ios.provenance.sourceGitSha,
    android.provenance.sourceGitSha,
  );
  return {
    androidPackage: android.applicationId,
    brandId: ios.brandId,
    channel: ios.channel,
    displayName: ios.displayName,
    iosBundleIdentifier: ios.applicationId,
    sourceGitSha: ios.provenance.sourceGitSha,
    urlScheme: ios.urlScheme,
  };
}

/** Deterministic bytes: two-space indent, lexicographically sorted keys, trailing newline —
 * the same serialization contract as the publisher's identity artifact. */
export function serializeExpoBrandOverlay(overlay: ExpoBrandOverlay): string {
  return `${JSON.stringify(
    Object.fromEntries(
      Object.entries(overlay).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    null,
    2,
  )}\n`;
}

const OVERLAY_KEYS = [
  'androidPackage',
  'brandId',
  'channel',
  'displayName',
  'iosBundleIdentifier',
  'sourceGitSha',
  'urlScheme',
] as const;

/** Structural check for the overlay JSON read back by app.config.ts. Deep identity validation
 * already happened at render time; this rejects truncated or hand-edited files. */
export function parseExpoBrandOverlay(value: unknown): ExpoBrandOverlay {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('expo brand overlay must be a JSON object');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== OVERLAY_KEYS.length || keys.some((key, i) => key !== OVERLAY_KEYS[i])) {
    fail(`expo brand overlay must contain exactly: ${OVERLAY_KEYS.join(', ')}`);
  }
  for (const key of OVERLAY_KEYS) {
    if (typeof record[key] !== 'string' || record[key] === '') {
      fail(`expo brand overlay field ${key} must be a non-empty string`);
    }
  }
  return record as unknown as ExpoBrandOverlay;
}

/** The default product name as it appears in user-facing template strings of the base config
 * (permission prompts). Only exact-case occurrences are rebranded; lowercase protocol/service
 * identifiers (`_linkcode._tcp`) are shared-core runtime contracts and stay untouched. */
const DEFAULT_PRODUCT_NAME = /LinkCode/g;

function rebrandStrings(value: unknown, displayName: string): unknown {
  if (typeof value === 'string') return value.replace(DEFAULT_PRODUCT_NAME, displayName);
  if (Array.isArray(value)) return value.map((entry) => rebrandStrings(entry, displayName));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        rebrandStrings(entry, displayName),
      ]),
    );
  }
  return value;
}

/** SDK 57's ExpoConfig type dropped the root `splash` key, but app.json still carries it and
 * prebuild still honors it — keep it typed so the brand image replacement is checked. */
export type ExpoBrandableConfig = ExpoConfig & {
  readonly splash?: Record<string, unknown>;
};

type PluginEntry = NonNullable<ExpoConfig['plugins']>[number];

/** Permission-prompt strings owned by these plugins are user-visible and carry the product
 * name; everything else in the plugin list (sentry project, gradle tweaks) is not identity. */
const REBRANDED_PLUGINS = new Set(['expo-audio', 'expo-local-authentication']);

function rebrandPlugin(
  entry: PluginEntry,
  overlay: ExpoBrandOverlay,
): PluginEntry {
  if (!Array.isArray(entry)) return entry;
  const [name, props] = entry;
  if (name === 'expo-sharing' && typeof props === 'object' && props !== null) {
    const shared = props as Record<string, unknown>;
    const ios = shared.ios;
    return [
      name,
      {
        ...shared,
        ...(typeof ios === 'object' && ios !== null
          ? {
              ios: {
                ...(ios as Record<string, unknown>),
                // The app group namespaces the share-extension container; it must follow the
                // brand's bundle id or two brands would share (and fight over) one container.
                appGroupId: `group.${overlay.iosBundleIdentifier}`,
              },
            }
          : {}),
      },
    ] as PluginEntry;
  }
  if (typeof name === 'string' && REBRANDED_PLUGINS.has(name)) {
    return [name, rebrandStrings(props, overlay.displayName)] as PluginEntry;
  }
  return entry;
}

/**
 * Applies one rendered brand overlay to the static base config. Everything identity-owned is
 * replaced wholesale — name, slug, scheme, application ids, icons/splash, permission prompts,
 * share app group — and the default product's update/EAS wiring is stripped: a branded build
 * must never publish to or update from the default project's channels (per-brand release
 * wiring is CODE-559, not identity).
 */
export function applyBrandExpoConfig(
  config: ExpoBrandableConfig,
  overlay: ExpoBrandOverlay,
  iconPath: string = MOBILE_BRAND_ICON_PATH,
): ExpoBrandableConfig {
  const { updates: _updates, description: _description, ...base } = config;
  const { eas: _eas, ...extra } = base.extra ?? {};
  return {
    ...base,
    android: {
      ...base.android,
      adaptiveIcon: {
        backgroundColor: base.android?.adaptiveIcon?.backgroundColor ?? '#FFFFFF',
        foregroundImage: iconPath,
      },
      package: overlay.androidPackage,
    },
    extra,
    icon: iconPath,
    ios: {
      ...base.ios,
      bundleIdentifier: overlay.iosBundleIdentifier,
      icon: iconPath,
      infoPlist: rebrandStrings(base.ios?.infoPlist, overlay.displayName) as Record<
        string,
        unknown
      >,
    },
    name: overlay.displayName,
    plugins: base.plugins?.map((entry) => rebrandPlugin(entry, overlay)),
    scheme: overlay.urlScheme,
    slug: overlay.brandId,
    splash: { ...base.splash, image: iconPath },
    web: { ...base.web, favicon: iconPath },
  };
}
