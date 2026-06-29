import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/__tests__/**/*.test.ts', 'apps/**/src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
