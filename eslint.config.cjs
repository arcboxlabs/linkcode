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
        // expo prebuild output (gitignored continuous native generation)
        'apps/mobile/ios/**',
        'apps/mobile/android/**',
        '.vscode/**',
        '.zed/**',
        '**/expo-export/**',
        'packages/vendor/coss-ui/**', // sync from upstream
        'pnpm-lock.yaml',
      ],
    },
    react: {
      files: [
        'apps/desktop/**',
        'apps/mobile/src/**',
        'apps/webview/src/**',
        'packages/presentation/ui/src/**',
        'packages/client/workbench/src/**',
        'packages/client/core/src/**',
      ],
      additionalHooks: '(useIsomorphicLayoutEffect|useAbortableEffect)',
    },
    stylistic: false,
    ts: {
      allowDefaultProject: [
        // apps/daemon/drizzle.config.ts is intentionally absent: it is included by the daemon's
        // tsconfig (project service), and a file must not appear in both.
        'apps/*/vite.config.ts',
        'apps/*/tsup.config.ts',
        // apps/desktop's vite.{shared,main,preload,renderer}.config.ts are intentionally absent
        // (and deliberately named so 'apps/*/vite.config.ts' does not match them): they are
        // included by the desktop tsconfig (project service), and a file must not appear in both.
        // Workspace tests belong to their source tsconfig or a tests/tsconfig.json referenced by
        // the root solution; listing them here too would breach typescript-eslint's 8-file cap.
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
      'packages/client/core/src/react.tsx',
      'packages/client/workbench/src/runtime.tsx',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: [
      'packages/host/agent-adapter/src/**/*.{ts,tsx}',
      'packages/host/engine/src/**/*.{ts,tsx}',
      'packages/client/sdk/src/client.ts',
    ],
    rules: {
      '@typescript-eslint/class-methods-use-this': 'off',
    },
  },
  {
    // Lexical nodes are class-based by API contract: overrides often take no `this`, and
    // `decorate()` returning JSX does not make the node class a React component.
    name: 'linkcode/lexical-node-classes',
    files: ['packages/presentation/ui/src/shell/composer-editor/nodes.tsx'],
    rules: {
      '@typescript-eslint/class-methods-use-this': 'off',
      'react-prefer-function-component/react-prefer-function-component': 'off',
    },
  },
  {
    // `~icons/*` are unplugin-icons virtual modules resolved by Vite at build time,
    // so the TypeScript import resolver can't see them.
    name: 'linkcode/unplugin-icons-virtual-modules',
    files: [
      'packages/presentation/ui/src/chat/agent-icon.tsx',
      'packages/presentation/ui/src/lib/__tests__/file-icon.test.ts',
      'packages/presentation/ui/src/lib/material-file-icons.ts',
      'packages/presentation/ui/src/shell/service-icon.tsx',
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
