import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { ExternalPackageIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { dependencies } from './package.json';

// Workspace packages are exported as TS source, so they must be bundled into main/preload (they
// can't be runtime externals): a require left in the bundle resolves to .ts under
// app.asar/node_modules and crashes on launch (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING).
// Derive the list from package.json instead of naming packages so a new workspace import into
// main can never be missed again.
const bundleWorkspace = {
  exclude: Object.entries(dependencies).flatMap(([name, version]) =>
    version.startsWith('workspace:') ? [name] : [],
  ),
};

export default defineConfig({
  main: {
    build: {
      externalizeDeps: bundleWorkspace,
    },
    plugins: [
      {
        name: 'bundle-daemon-artifact',
        // The daemon ships inside the desktop app (CODE-86): the supervisor forks the daemon's own
        // tsup (esbuild) build artifact under Electron's Node. Consuming apps/daemon/dist — built
        // first via turbo `^build`, since @linkcode/daemon is a dependency — keeps bundling owned
        // by the daemon and out/daemon identical to the standalone prod bundle (`pnpm start`).
        // Its runtime externals (better-sqlite3, agent SDKs, …) resolve from asar node_modules,
        // collected by electron-builder through the @linkcode/daemon dependency edge.
        // instrument.js is deliberately not shipped: @sentry/profiling-node is a native module the
        // Electron rebuild need not carry; child crashes surface via the supervisor's stderr pipe.
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
  },
  preload: {
    build: {
      // The preload runs sandboxed and cannot `require()` external node_modules at runtime, so the
      // better-auth electron bridge must be bundled in, not externalized (unlike in main).
      externalizeDeps: {
        exclude: [...bundleWorkspace.exclude, '@better-auth/electron'],
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [
      react({
        babel: {
          plugins: ['babel-plugin-react-compiler'],
        },
      }),
      tailwindcss(),
      Icons({
        compiler: 'jsx',
        jsx: 'react',
        customCollections: ExternalPackageIconLoader('@proj-airi/lobe-icons'),
      }),
    ],
    resolve: {
      alias: {
        '@desktop': resolve(__dirname, 'src'),
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
      dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    // Workspace packages are exported as TS source and transpiled on the fly, so skip prebundling them.
    optimizeDeps: {
      exclude: [
        '@linkcode/client-core',
        '@linkcode/i18n',
        '@linkcode/sdk',
        '@linkcode/schema',
        '@linkcode/transport',
        '@linkcode/ui',
        '@linkcode/workbench',
        'coss-ui',
      ],
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
