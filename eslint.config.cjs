'use strict';

const path = require('node:path');
const { createTypeScriptImportResolver } = require('eslint-import-resolver-typescript');

module.exports = require('eslint-config-sukka').sukka(
  {
    ignores: {
      customGlobs: [
        'assets/**',
        '**/dist/**',
        '**/out/**',
        '**/build/**',
        '**/.vite/**',
        '**/.turbo/**',
        '**/.expo/**',
        '.zed/**',
        '**/expo-export/**',
        'packages/coss-ui/**',
        'pnpm-lock.yaml',
      ],
    },
    react: {
      additionalHooks: '(useIsomorphicLayoutEffect|useAbortableEffect)',
    },
    stylistic: false,
    ts: {
      tsconfigRootDir: __dirname,
      allowDefaultProject: [
        '*.config.ts',
        'apps/*/*.config.ts',
        'apps/*/tsup.config.ts',
        'apps/desktop/electron.vite.config.ts',
        'packages/agent-adapter/src/__tests__/*.test.ts',
        'vitest.config.ts',
      ],
    },
  },
  {
    name: 'linkcode/import-resolver',
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          noWarnOnMultipleProjects: true,
          project: [
            path.join(__dirname, 'tsconfig.json'),
            path.join(__dirname, 'apps/*/tsconfig.json'),
            path.join(__dirname, 'packages/*/tsconfig.json'),
          ],
        }),
      ],
    },
  },
  {
    files: ['eslint.config.cjs', '**/*.config.js', '**/*.cjs'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        exports: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
      sourceType: 'commonjs',
    },
  },
  {
    files: ['packages/**/*.{ts,tsx}', 'apps/webview/src/components/data-table/index.tsx'],
    rules: {
      '@eslint-react/no-context-provider': 'off',
      '@eslint-react/no-use-context': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: [
      'apps/daemon/src/index.ts',
      'apps/desktop/src/main/index.ts',
      'apps/server/src/index.ts',
      'packages/client-core/src/react.tsx',
      'packages/workbench/src/runtime.tsx',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: [
      'packages/agent-adapter/src/**/*.{ts,tsx}',
      'packages/engine/src/**/*.{ts,tsx}',
      'packages/sdk/src/client.ts',
    ],
    rules: {
      '@typescript-eslint/class-methods-use-this': 'off',
    },
  },
  {
    // `~icons/*` are unplugin-icons virtual modules resolved by Vite at build time,
    // so the TypeScript import resolver can't see them.
    name: 'linkcode/unplugin-icons-virtual-modules',
    files: ['packages/ui/src/shell/agent-icon.tsx'],
    rules: {
      'import-x/no-unresolved': ['error', { ignore: ['^~icons/'] }],
    },
  },
);
