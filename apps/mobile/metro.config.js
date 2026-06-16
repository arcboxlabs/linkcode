// Expo monorepo Metro 配置：让 mobile 能解析 workspace 包（@linkcode/schema 等，
// 以 TS 源码导出）与 hoisted 到根的三方依赖。
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1) 监听整个 workspace，以便引用其它包的源码。
config.watchFolders = [workspaceRoot];

// 2) 同时从本地与根 node_modules 解析依赖（.npmrc 使用 node-linker=hoisted）。
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
