'use strict';

module.exports = require('eslint-config-sukka').sukka(
  {
    ignores: {
      customGlobs: [
        '.claude/**',
        'assets/**',
        '**/dist/**',
        '**/out/**',
        '**/build/**',
        '**/release/**',
        '**/.vite/**',
        '**/.turbo/**',
        '**/.expo/**',
        '.vscode/**',
        '.zed/**',
        '**/expo-export/**',
        'packages/coss-ui/**', // sync from upstream
        'pnpm-lock.yaml',
      ],
    },
    react: {
      files: [
        'apps/desktop/**',
        'apps/mobile/src/**',
        'apps/webview/src/**',
        'packages/ui/src/**',
        'packages/workbench/src/**',
        'packages/client-core/src/**',
      ],
      additionalHooks: '(useIsomorphicLayoutEffect|useAbortableEffect)',
    },
    stylistic: false,
    ts: {
      allowDefaultProject: [
        '*.config.ts',
        // apps/daemon/drizzle.config.ts is intentionally absent: it is included by the daemon's
        // tsconfig (project service), and a file must not appear in both.
        'apps/*/vite.config.ts',
        'apps/*/tsup.config.ts',
        // apps/desktop/electron.vite.config.ts is intentionally absent: it is included by the
        // desktop tsconfig (project service), and a file must not appear in both.
        // agent-adapter tests are included by that package's tsconfig like every other package's;
        // listing them here too would breach typescript-eslint's 8-file default-project cap.
        'vitest.config.ts',
      ],
    },
  },
  {
    // Biome's formatter lower-cases hex digits in number literals with no option to
    // disable it, while unicorn insists on upper case. Biome owns literal casing;
    // keep the two from fighting over every hex constant.
    name: 'linkcode/number-literal-case-owned-by-biome',
    rules: {
      'sukka/unicorn/number-literal-case': 'off',
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
    files: [
      'packages/ui/src/chat/agent-icon.tsx',
      'packages/ui/src/lib/__tests__/file-icon.test.ts',
      'packages/ui/src/lib/material-file-icons.ts',
      'packages/ui/src/shell/service-icon.tsx',
    ],
    rules: {
      'import-x/no-unresolved': ['error', { ignore: ['^~icons/'] }],
    },
  },
  {
    // tsconfig files are JSONC by spec, and the root tsconfig.json carries a
    // load-bearing comment about its reference ordering.
    name: 'linkcode/tsconfig-is-jsonc',
    files: ['**/tsconfig*.json'],
    rules: {
      'jsonc/no-comments': 'off',
    },
  },
);
