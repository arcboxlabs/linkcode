// Dynamic Expo config (CODE-558): app.json stays the default-product base; when
// scripts/render-config-bundle.mts has rendered a brand into generated/, every identity-owned
// field is replaced from that immutable overlay before prebuild — there is no runtime mutation
// of native identity and no partial application: an incomplete or inconsistent generated set
// aborts config evaluation instead of falling back to the default brand.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrandIdentityArtifact } from '@linkcode/common/config';
import type { ConfigContext, ExpoConfig } from 'expo/config';
// The explicit .ts extension is load-bearing: Expo's config evaluator transpiles only this
// entry file, so the import must resolve through Node's own require — which loads .ts (type
// stripping, Node >= 24) only when the extension is spelled out.
import {
  applyBrandExpoConfig,
  applyBrandReleaseConfig,
  deriveExpoBrandOverlay,
  parseExpoBrandOverlay,
  parseExpoBrandReleaseConfig,
  serializeExpoBrandOverlay,
} from './src/build/expo-brand.ts';

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function loadGeneratedBrand(): ReturnType<typeof parseExpoBrandOverlay> | null {
  const generatedDir = join(__dirname, 'generated');
  const overlayPath = join(generatedDir, 'expo-brand.json');
  const iosPath = join(generatedDir, 'brand-identity.ios.json');
  const androidPath = join(generatedDir, 'brand-identity.android.json');
  const iconPath = join(generatedDir, 'brand-assets', 'icon.png');
  const present = [overlayPath, iosPath, androidPath, iconPath].filter((path) => existsSync(path));
  if (present.length === 0) return null;
  if (present.length !== 4) {
    throw new Error(
      'apps/mobile/generated is incomplete — re-run `pnpm -F @linkcode/mobile config:render`',
    );
  }
  const overlay = parseExpoBrandOverlay(JSON.parse(readFileSync(overlayPath, 'utf8')));
  // The overlay must still be the one derived from the identity artifacts next to it; a
  // hand-edited overlay (or a stale one after re-rendering another brand) fails here. Deep
  // field validation ran at render time (the renderer only writes publisher-validated
  // artifacts); Expo CLI's config evaluator cannot load @linkcode/common at runtime, so this
  // re-check is structural: platform split, cross-platform consistency, and overlay equality.
  const rederived = deriveExpoBrandOverlay(
    JSON.parse(readFileSync(iosPath, 'utf8')) as BrandIdentityArtifact,
    JSON.parse(readFileSync(androidPath, 'utf8')) as BrandIdentityArtifact,
  );
  if (serializeExpoBrandOverlay(rederived) !== serializeExpoBrandOverlay(overlay)) {
    throw new Error(
      'apps/mobile/generated/expo-brand.json does not match the rendered identity artifacts — ' +
        're-run `pnpm -F @linkcode/mobile config:render`',
    );
  }
  const icon = readFileSync(iconPath);
  if (icon.length < PNG_MAGIC.length || !icon.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new Error('apps/mobile/generated/brand-assets/icon.png is not a PNG');
  }
  return overlay;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  const overlay = loadGeneratedBrand();
  const releasePath = join(__dirname, 'generated', 'mobile-release.json');
  if (overlay === null) {
    if (existsSync(releasePath)) throw new Error('mobile-release.json requires a rendered brand');
    return base;
  }
  const branded = applyBrandExpoConfig(base, overlay);
  if (!existsSync(releasePath)) return branded;
  const release = parseExpoBrandReleaseConfig(JSON.parse(readFileSync(releasePath, 'utf8')));
  return applyBrandReleaseConfig(branded, overlay, release);
};
