// Expo monorepo Metro config + NativeWind + Sentry.
// getSentryExpoConfig wraps Expo's default config with Sentry's source-map serializer.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

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

// 3) Apply NativeWind, compiling ./src/global.css into the bundle.
module.exports = withNativeWind(config, { input: './src/global.css' });
