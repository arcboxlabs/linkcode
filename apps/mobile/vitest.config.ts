import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

/** This app pins react/react-dom to the version Expo's SDK bundles (AGENTS.md) while the catalog
 * holds a later patch, so its copies are nested instead of hoisted. Left alone, a hook under test
 * resolves the pinned copy while
 * `@testing-library/react` — hoisted, and loaded by Node rather than Vite — resolves the other:
 * two React instances, and every hook dies on a null dispatcher (CODE-444). Point the tests at
 * the hoisted pair so both sides agree. Safe because the pin exists for Metro's bundle, and
 * vitest never builds it; only RN-free modules belong in this project. */
function hoisted(specifier: string): string {
  return join(import.meta.dirname, '..', '..', 'node_modules', specifier);
}

export default defineConfig({
  resolve: {
    alias: {
      '@mobile': join(import.meta.dirname, 'src'),
      react: hoisted('react'),
      'react-dom': hoisted('react-dom'),
    },
  },
  test: {
    name: 'mobile',
    root: import.meta.dirname,
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
