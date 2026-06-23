import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Workspace packages are exported as TS source, so they must be bundled into main/preload (they can't be runtime externals).
const bundleWorkspace = {
  exclude: [
    '@linkcode/ipc',
    '@linkcode/schema',
    '@linkcode/transport',
    '@linkcode/client-core',
    '@linkcode/ui',
  ],
};

export default defineConfig({
  main: {
    build: {
      externalizeDeps: bundleWorkspace,
    },
  },
  preload: {
    build: {
      externalizeDeps: bundleWorkspace,
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
    ],
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer/src') },
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
