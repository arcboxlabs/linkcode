import { resolve } from 'node:path';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { ExternalPackageIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';

export default defineConfig({
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
    alias: { '@webview': resolve(import.meta.dirname, 'src') },
    // pnpm's hoisted layout can nest a second react under a dep whose peer resolved to another
    // version — pin every import to the root copy (same as desktop's vite.renderer.config).
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  server: { port: 5173 },
  // Workspace packages are exported as TS source and transpiled on the fly by Vite/esbuild, so no prebundling is needed.
  optimizeDeps: {
    exclude: [
      '@linkcode/common',
      '@linkcode/i18n',
      '@linkcode/schema',
      '@linkcode/sdk',
      '@linkcode/transport',
      '@linkcode/ui',
      '@linkcode/workbench',
      'coss-ui',
    ],
  },
});
