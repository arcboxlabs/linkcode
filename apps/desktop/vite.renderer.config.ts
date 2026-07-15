import { resolve } from 'node:path';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { ExternalPackageIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';
import { CHROME_TARGET } from './vite.shared';

export default defineConfig(({ command }) => ({
  root: resolve(__dirname, 'src/renderer'),
  // The packaged app loads out/renderer/index.html via loadFile, so built asset URLs must be
  // relative; the dev server keeps the default absolute base.
  base: command === 'build' ? './' : '/',
  envDir: __dirname,
  envPrefix: ['RENDERER_VITE_', 'VITE_'],
  plugins: [
    react(),
    // plugin-react 6 dropped its built-in babel pass; React Compiler runs via rolldown's babel
    // plugin instead.
    babel({ presets: [reactCompilerPreset()] }),
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
    target: CHROME_TARGET,
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: { index: resolve(__dirname, 'src/renderer/index.html') },
    },
    minify: false,
    reportCompressedSize: false,
  },
}));
