import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { assetPlugin, NODE_TARGET, nodeExternals, processEnvDefine } from './vite.shared';

// Build-time immutable config: scripts/render-config-bundle.mts writes both files from the pinned
// publisher render. When they exist, the derived bootstrap is inlined into the main bundle and any
// ambient MAIN_VITE_CONFIG_BOOTSTRAP is a hard error — generated output cannot be overridden.
function loadGeneratedConfigBootstrap(): { bootstrapJson: string; bundlePath: string } | null {
  const bootstrapPath = resolve(__dirname, 'generated/config-bootstrap.json');
  const bundlePath = resolve(__dirname, 'generated/config-build-bundle.json');
  const hasBootstrap = existsSync(bootstrapPath);
  const hasBundle = existsSync(bundlePath);
  if (!hasBootstrap && !hasBundle) {
    if (process.env.LINKCODE_REQUIRE_CONFIG_BUNDLE === '1') {
      throw new Error(
        'LINKCODE_REQUIRE_CONFIG_BUNDLE=1 but apps/desktop/generated is empty — run ' +
          '`pnpm -F @linkcode/desktop config:render` with pinned inputs before building',
      );
    }
    return null;
  }
  if (!hasBootstrap || !hasBundle) {
    throw new Error(
      'apps/desktop/generated is incomplete — re-run `pnpm -F @linkcode/desktop config:render`',
    );
  }
  if (process.env.MAIN_VITE_CONFIG_BOOTSTRAP) {
    throw new Error(
      'MAIN_VITE_CONFIG_BOOTSTRAP must not be set when a generated config bundle exists; ' +
        'the generated bootstrap is immutable',
    );
  }
  const bootstrapJson = readFileSync(bootstrapPath, 'utf8');
  JSON.parse(bootstrapJson);
  return { bootstrapJson, bundlePath };
}

const generatedConfig = loadGeneratedConfigBootstrap();

export default defineConfig({
  root: __dirname,
  define: {
    ...processEnvDefine,
    ...(generatedConfig && {
      'import.meta.env.MAIN_VITE_CONFIG_BOOTSTRAP': JSON.stringify(generatedConfig.bootstrapJson),
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
        if (!generatedConfig) return;
        // Provenance record shipped next to the inlined bootstrap (out/** is packed into the asar).
        const outConfig = resolve(__dirname, 'out/config');
        mkdirSync(outConfig, { recursive: true });
        cpSync(generatedConfig.bundlePath, resolve(outConfig, 'build-bundle.json'));
      },
    },
  ],
});
