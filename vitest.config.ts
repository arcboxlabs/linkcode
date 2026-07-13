import { fileURLToPath } from 'node:url';
import { ExternalPackageIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirror the renderers' unplugin-icons setup so modules importing `~icons/*`
  // virtual modules (e.g. the shell's AgentIcon) load under the root vitest runner.
  plugins: [
    Icons({
      compiler: 'jsx',
      jsx: 'react',
      customCollections: ExternalPackageIconLoader('@proj-airi/lobe-icons'),
    }),
  ],
  test: {
    include: [
      'packages/**/src/**/__tests__/**/*.test.{ts,tsx}',
      'apps/**/src/**/__tests__/**/*.test.{ts,tsx}',
    ],
    environment: 'node',
  },
  resolve: {
    // Mirror apps/desktop's `@renderer` path alias (apps/desktop/tsconfig.json + electron.vite.config.ts)
    // so the desktop unit tests resolve when run under the root vitest runner.
    alias: {
      '@renderer': fileURLToPath(new URL('./apps/desktop/src/renderer/src', import.meta.url)),
    },
  },
});
