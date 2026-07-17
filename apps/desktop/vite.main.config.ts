import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { assetPlugin, NODE_TARGET, nodeExternals, processEnvDefine } from './vite.shared';

export default defineConfig({
  root: __dirname,
  define: processEnvDefine,
  envPrefix: ['MAIN_VITE_', 'VITE_'],
  resolve: {
    mainFields: ['module', 'jsnext:main', 'jsnext'],
    conditions: ['node'],
  },
  ssr: { noExternal: true },
  build: {
    ssr: true,
    ssrEmitAssets: true,
    target: NODE_TARGET,
    outDir: 'out/main',
    assetsDir: 'chunks',
    lib: {
      entry: resolve(__dirname, 'src/main/index.ts'),
      formats: ['cjs'],
    },
    rolldownOptions: {
      external: nodeExternals(),
      output: {
        entryFileNames: '[name].js',
        assetFileNames: 'chunks/[name]-[hash][extname]',
      },
    },
    minify: false,
    modulePreload: false,
    copyPublicDir: false,
    reportCompressedSize: false,
  },
  plugins: [
    assetPlugin(),
    {
      name: 'bundle-daemon-artifact',
      // The daemon ships inside the desktop app (CODE-86): consume apps/daemon/dist (turbo `^build`
      // orders it) so bundling stays owned by the daemon; its runtime externals resolve from asar
      // node_modules through the @linkcode/daemon dependency edge. instrument.js is deliberately not
      // shipped (@sentry/profiling-node is a native module the Electron rebuild need not carry).
      closeBundle() {
        const dist = resolve(__dirname, '../daemon/dist/index.js');
        if (!existsSync(dist)) {
          throw new Error(
            'apps/daemon/dist is missing — run `pnpm -F @linkcode/daemon build` first',
          );
        }
        mkdirSync(resolve(__dirname, 'out/daemon'), { recursive: true });
        // .mjs: the dist file is ESM but leaves the daemon package's type=module scope when copied.
        cpSync(dist, resolve(__dirname, 'out/daemon/index.mjs'));
        // The daemon locates drizzle migrations relative to its bundle (`../drizzle` from
        // out/daemon/index.mjs — see apps/daemon/src/session-store.ts).
        cpSync(resolve(__dirname, '../daemon/drizzle'), resolve(__dirname, 'out/drizzle'), {
          recursive: true,
        });
      },
    },
  ],
});
