// Expo monorepo Metro config: lets mobile resolve workspace packages (@linkcode/schema and others,
// exported as TS source) along with third-party dependencies hoisted to the root.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1) Watch the entire workspace so source from other packages can be referenced.
config.watchFolders = [workspaceRoot];

// 2) Resolve dependencies from both the local and the root node_modules (.npmrc uses node-linker=hoisted).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
