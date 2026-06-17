import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

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
    plugins: [externalizeDepsPlugin(bundleWorkspace)],
  },
  preload: {
    plugins: [externalizeDepsPlugin(bundleWorkspace)],
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: {
      dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    // Workspace packages are exported as TS source and transpiled on the fly, so skip prebundling them.
    optimizeDeps: {
      exclude: [
        '@linkcode/ui',
        '@linkcode/client-core',
        '@linkcode/i18n',
        '@linkcode/transport',
        '@linkcode/schema',
      ],
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
