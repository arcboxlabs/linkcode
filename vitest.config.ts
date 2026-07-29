import { fileURLToPath } from 'node:url';
import { ExternalPackageIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // apps/mobile is its own project: it pins react to RN's bundled renderer, so its tests must
    // resolve a different copy than everything else (apps/mobile/vitest.config.ts).
    projects: [
      {
        // Mirror the renderers' unplugin-icons setup so modules importing `~icons/*`
        // virtual modules (e.g. the shell's AgentIcon) load under the root vitest runner.
        plugins: [
          Icons({
            compiler: 'jsx',
            jsx: 'react',
            customCollections: ExternalPackageIconLoader('@proj-airi/lobe-icons'),
          }),
        ],
        resolve: {
          // Mirror apps/desktop's `@renderer` path alias (apps/desktop/tsconfig.json +
          // electron.vite.config.ts) so the desktop unit tests resolve under this runner.
          alias: {
            '@renderer': fileURLToPath(new URL('./apps/desktop/src/renderer/src', import.meta.url)),
          },
        },
        test: {
          name: 'default',
          include: [
            'packages/**/src/**/__tests__/**/*.test.{ts,tsx}',
            'apps/**/src/**/__tests__/**/*.test.{ts,tsx}',
            'packages/**/tests/{contract,integration}/**/*.test.{ts,tsx}',
            'apps/**/tests/{contract,integration}/**/*.test.{ts,tsx}',
            '.github/scripts/**/*.test.mjs',
          ],
          exclude: [...configDefaults.exclude, 'apps/mobile/**'],
          environment: 'node',
          // Belongs to this project rather than the root: projects do not inherit root `test`
          // options, and what it patches (jsdom gaps `@pierre/diffs` hits) is web-renderer only.
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      './apps/mobile/vitest.config.ts',
    ],
  },
});
