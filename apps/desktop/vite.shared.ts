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

// Workspace packages are exported as TS source, so they must be bundled into main/preload (they
// can't be runtime externals): a require left in the bundle resolves to .ts under
// app.asar/node_modules and crashes on launch (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING).
// Derive the list from package.json instead of naming packages so a new workspace import into
// main can never be missed again. Everything else in `dependencies` stays external and resolves
// from asar node_modules at runtime, exactly like electron-vite's externalizeDepsPlugin did.
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

// `import file from './x.png?asset'` in the main process resolves to an absolute path of the
// asset emitted next to the bundle (out/main/chunks/…). Minimal replacement for electron-vite's
// asset plugin; the ?asset&asarUnpack / .node / .wasm variants were never used and are not
// supported.
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
