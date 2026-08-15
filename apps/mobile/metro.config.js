// Expo monorepo Metro config + Uniwind + Sentry.
// getSentryExpoConfig wraps Expo's default config with Sentry's source-map serializer.
const { existsSync } = require('node:fs');
const path = require('node:path');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withUniwindConfig } = require('uniwind/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getSentryExpoConfig(projectRoot);

// 1) Watch the whole workspace so source from other packages (@linkcode/schema, exported as TS) is visible.
config.watchFolders = [workspaceRoot];

// 2) Resolve deps from both the local and root node_modules (.npmrc uses node-linker=hoisted).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3) Native identity and the in-app mark must select one complete generated asset set or none.
const brandMarkModule = '@mobile/components/shell/brand-mark-icon';
const generatedBrandIcon = path.resolve(projectRoot, 'generated/brand-assets/icon.png');
const generatedBrandFiles = [
  path.resolve(projectRoot, 'generated/expo-brand.json'),
  path.resolve(projectRoot, 'generated/brand-identity.ios.json'),
  path.resolve(projectRoot, 'generated/brand-identity.android.json'),
  generatedBrandIcon,
];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  let request = moduleName;
  if (moduleName === brandMarkModule) {
    const present = generatedBrandFiles.filter((file) => existsSync(file));
    if (present.length !== 0 && present.length !== generatedBrandFiles.length) {
      throw new Error(
        'apps/mobile/generated is incomplete — re-run `pnpm -F @linkcode/mobile config:render`',
      );
    }
    if (present.length === generatedBrandFiles.length) {
      request = generatedBrandIcon;
    }
  }
  return context.resolveRequest(context, request, platform);
};

// 4) Bundle the terminal's self-hosted font in native and web exports.
// expo-sqlite's web worker imports WASM, while the DOM terminal bundles local WOFF2 fonts.
config.resolver.assetExts.push('wasm', 'woff2');

// 5) Apply Uniwind, compiling ./src/global.css and generating className typings.
module.exports = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  dtsFile: './src/uniwind-types.d.ts',
});
