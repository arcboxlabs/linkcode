import { fileURLToPath } from 'node:url';
import { ExternalPackageIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { configDefaults, defineConfig } from 'vitest/config';

const abs = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * `apps/mobile` pins react/react-dom to the exact pair React Native bundles (see
 * apps/mobile/AGENTS.md), which trails the hoisted root copy. Rendering a mobile hook must load
 * exactly ONE React: the app's own copy wins for app source, while `@testing-library/react` exists
 * only at the root and drags the root renderer in — two dispatchers, and `useContext` reads a null
 * one.
 *
 * The mobile project therefore pins BOTH at the root pair for tests only. The versions differ by a
 * patch on the same 19.2.x line, so hook semantics are identical; the app's own pin — the one that
 * has to match RN's bundled renderer at runtime — is untouched. Aliasing the other direction was
 * tried first and does not hold: `@testing-library/react` is resolved by Node as an external dep
 * and never sees the alias.
 */
const rootReact = abs('./node_modules/react');
const rootReactDom = abs('./node_modules/react-dom');

const SHARED_INCLUDE = [
  'packages/**/src/**/__tests__/**/*.test.{ts,tsx}',
  'apps/**/src/**/__tests__/**/*.test.{ts,tsx}',
  'packages/**/tests/{contract,integration}/**/*.test.{ts,tsx}',
  'apps/**/tests/{contract,integration}/**/*.test.{ts,tsx}',
  '.github/scripts/**/*.test.mjs',
];

export default defineConfig({
  test: {
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
        test: {
          name: 'default',
          include: SHARED_INCLUDE,
          exclude: [...configDefaults.exclude, 'apps/mobile/**'],
          environment: 'node',
        },
        resolve: {
          // Mirror apps/desktop's `@renderer` path alias (apps/desktop/tsconfig.json + electron.vite.config.ts)
          // so the desktop unit tests resolve when run under the root vitest runner.
          alias: {
            '@renderer': abs('./apps/desktop/src/renderer/src'),
          },
        },
      },
      {
        test: {
          name: 'mobile',
          include: ['apps/mobile/src/**/__tests__/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
        resolve: {
          // Anchored patterns: a bare `react` prefix would also rewrite `react-native`.
          alias: [
            { find: /^react$/, replacement: rootReact },
            { find: /^react\/(.*)$/, replacement: `${rootReact}/$1` },
            { find: /^react-dom$/, replacement: rootReactDom },
            { find: /^react-dom\/(.*)$/, replacement: `${rootReactDom}/$1` },
          ],
        },
      },
    ],
  },
});
