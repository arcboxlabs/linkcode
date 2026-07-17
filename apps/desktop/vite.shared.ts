import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { basename } from 'node:path';
import type { Plugin } from 'vite';
import { dependencies } from './package.json';

// Electron's bundled Node and Chrome versions. Keep in sync with the hardcoded `electronVersion`
// in electron-builder.yml (sync rule in docs/RELEASE.md); read them from the pinned binary with
// `ELECTRON_RUN_AS_NODE=1 electron -p "process.versions"`.
export const NODE_TARGET = 'node24.16';
export const CHROME_TARGET = 'chrome148';

// Workspace packages export raw TS, so they must be bundled into main/preload: a require left in
// the bundle resolves to .ts under app.asar/node_modules and crashes on launch
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Derived from package.json so a new workspace
// import can never be missed; everything else in `dependencies` stays external.
export function nodeExternals(alsoBundle: readonly string[] = []): Array<string | RegExp> {
  const external = Object.entries(dependencies).flatMap(([name, version]) =>
    version.startsWith('workspace:') || alsoBundle.includes(name) ? [] : [name],
  );
  return [
    'electron',
    /^electron\/.+/,
    ...builtinModules.flatMap((m) => [m, `node:${m}`]),
    ...external,
    new RegExp(`^(${external.join('|')})/`),
  ];
}

// Keep `process.env` reads dynamic in the node bundles instead of letting Vite statically
// replace them (mirrors electron-vite's processEnvDefine).
export const processEnvDefine = {
  'process.env': 'process.env',
  'global.process.env': 'global.process.env',
  'globalThis.process.env': 'globalThis.process.env',
};

const ASSET_RE = /__LINKCODE_ASSET__([\w$]+)__/g;

// `?asset` imports in main resolve to the absolute path of the asset emitted next to the bundle.
// Minimal replacement for electron-vite's asset plugin; the ?asset&asarUnpack / .node / .wasm
// variants are not supported.
export function assetPlugin(): Plugin {
  return {
    name: 'linkcode:asset',
    apply: 'build',
    enforce: 'pre',
    async load(id) {
      if (!id.endsWith('?asset')) return null;
      const file = id.slice(0, -'?asset'.length);
      const referenceId = this.emitFile({
        type: 'asset',
        name: basename(file),
        source: await readFile(file),
      });
      return `export default __LINKCODE_ASSET__${referenceId}__;`;
    },
    renderChunk(code) {
      if (!ASSET_RE.test(code)) return null;
      return code.replaceAll(
        ASSET_RE,
        (_, referenceId: string) =>
          `require("node:path").join(__dirname, ${JSON.stringify(this.getFileName(referenceId))})`,
      );
    },
  };
}
