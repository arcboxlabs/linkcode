'use strict';

const { createTypeScriptImportResolver } = require('eslint-import-resolver-typescript');

module.exports = require('eslint-config-sukka').sukka(
  {
    ignores: {
      customGlobs: [
        '**/dist/**',
        '**/out/**',
        '**/build/**',
        '**/.vite/**',
        '**/.turbo/**',
        '**/.expo/**',
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
      allowDefaultProject: [
        '*.config.ts',
        'apps/*/*.config.ts',
        'apps/*/tsup.config.ts',
        'apps/desktop/electron.vite.config.ts',
        'packages/agent-adapter/src/__tests__/normalize.test.ts',
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
          project: ['tsconfig.json', 'apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
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
      'react-refresh/only-export-components': 'off',
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
);
