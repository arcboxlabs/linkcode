import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/__tests__/**/*.test.ts', 'apps/**/src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    // Mirror apps/desktop's `@desktop` path alias (apps/desktop/tsconfig.json + electron.vite.config.ts)
    // so the desktop unit tests resolve when run under the root vitest runner.
    alias: {
      '@desktop': fileURLToPath(new URL('./apps/desktop/src/renderer/src', import.meta.url)),
    },
  },
});
