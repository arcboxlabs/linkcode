// Expo monorepo Metro config + Uniwind + Sentry.
// getSentryExpoConfig wraps Expo's default config with Sentry's source-map serializer.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withUniwindConfig } = require('uniwind/metro');
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

// 3) Apply Uniwind, compiling ./src/global.css and generating className typings.
module.exports = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  dtsFile: './src/uniwind-types.d.ts',
});
