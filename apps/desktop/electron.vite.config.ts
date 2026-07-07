import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { ExternalPackageIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';

// Workspace packages are exported as TS source, so they must be bundled into main/preload (they
// can't be runtime externals): a require left in the bundle resolves to .ts under
// app.asar/node_modules and crashes on launch (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING).
// Derive the list from package.json instead of naming packages so a new workspace import into
// main can never be missed again.
const { dependencies } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};
const bundleWorkspace = {
  exclude: Object.keys(dependencies).filter((name) => dependencies[name].startsWith('workspace:')),
};

export default defineConfig({
  main: {
    build: {
      externalizeDeps: bundleWorkspace,
    },
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
