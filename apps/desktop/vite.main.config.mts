import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
// Relative .mts import: Vite's config bundler inlines it (and its deep import into the config
// package source); a bare workspace import would be externalized and fail under plain Node.
import { loadGeneratedConfigBundle, stageConfigBundle } from './scripts/config-bundle.mts';
import { assetPlugin, NODE_TARGET, nodeExternals, processEnvDefine } from './vite.shared';

const generatedConfig = loadGeneratedConfigBundle(__dirname, process.env);

export default defineConfig({
  root: __dirname,
  define: {
    ...processEnvDefine,
    ...(generatedConfig && {
      'import.meta.env.MAIN_VITE_CONFIG_BOOTSTRAP': JSON.stringify(generatedConfig.bootstrapJson),
    }),
    ...(generatedConfig?.brandIdentityJson !== undefined && {
      'import.meta.env.MAIN_VITE_BRAND_IDENTITY': JSON.stringify(generatedConfig.brandIdentityJson),
    }),
  },
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
      // @linkcode/cloud is ESM-only; bundle its tiny URL builder into the CJS main process.
      external: nodeExternals(['@linkcode/cloud']),
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
      closeBundle() {
        const dist = resolve(__dirname, '../daemon/dist/index.js');
        if (!existsSync(dist)) {
          throw new Error(
            'apps/daemon/dist is missing — run `pnpm -F @linkcode/daemon build` first',
          );
        }
        const outDaemon = resolve(__dirname, 'out/daemon');
        mkdirSync(outDaemon, { recursive: true });
        // .mjs: the dist file is ESM but leaves the daemon package's type=module scope when copied.
        cpSync(dist, resolve(outDaemon, 'index.mjs'));
        const instrument = resolve(__dirname, '../daemon/dist/instrument.js');
        if (existsSync(instrument)) {
          cpSync(instrument, resolve(outDaemon, 'instrument.mjs'));
        }
        // The daemon locates drizzle migrations relative to its bundle (`../drizzle` from
        // out/daemon/index.mjs — see apps/daemon/src/session-store.ts).
        cpSync(resolve(__dirname, '../daemon/drizzle'), resolve(__dirname, 'out/drizzle'), {
          recursive: true,
        });
      },
    },
    {
      name: 'stage-config-build-bundle',
      closeBundle() {
        stageConfigBundle(__dirname, generatedConfig);
      },
    },
  ],
});
