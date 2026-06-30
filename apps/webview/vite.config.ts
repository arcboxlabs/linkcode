import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { ExternalPackageIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';

export default defineConfig({
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
  resolve: { alias: { '@webview': resolve(import.meta.dirname, 'src') } },
  server: { port: 5173 },
  // Workspace packages are exported as TS source and transpiled on the fly by Vite/esbuild, so no prebundling is needed.
  optimizeDeps: {
    exclude: [
      '@linkcode/i18n',
      '@linkcode/sdk',
      '@linkcode/transport',
      '@linkcode/ui',
      '@linkcode/workbench',
      'coss-ui',
    ],
  },
});
