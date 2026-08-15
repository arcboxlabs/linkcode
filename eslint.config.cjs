'use strict';

module.exports = require('eslint-config-sukka').sukka(
  {
    ignores: {
      customGlobs: [
        '.claude/**',
        '.agents/skills/**', // sync from upstream, tracked by skills-lock.json
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
        // gitignored per-target config modules rendered by the pinned publisher (CODE-552)
        'apps/mobile/src/runtime/config/bundled.generated.ios.ts',
        'apps/mobile/src/runtime/config/bundled.generated.android.ts',
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
      additionalHooks: '(useIsomorphicLayoutEffect|useEffect)',
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
        'vitest.setup.ts',
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
      'packages/host/agent-adapter/tests/**/*.{ts,tsx}',
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
      'packages/presentation/ui/src/chat/integration-brand.tsx',
      'packages/presentation/ui/src/lib/__tests__/file-icon.test.ts',
      'packages/presentation/ui/src/lib/material-file-icons.ts',
      'packages/presentation/ui/src/shell/service-icon.tsx',
    ],
    rules: {
      'import-x/no-unresolved': ['error', { ignore: ['^~icons/'] }],
    },
  },
  {
    // jsx-a11y reads these as DOM props, but the JSX here is `@expo/ui`'s SwiftUI views:
    // `Image` is an SF Symbol with no `alt` (decorative next to the row's own label), and
    // `role` is SwiftUI's `ButtonRole`, not an ARIA role. Only files that render a real RN
    // element are exempted back, so the checks still cover the shrinking non-SwiftUI set.
    name: 'linkcode/expo-ui-props-are-not-dom-props',
    files: ['apps/mobile/src/**/*.tsx'],
    ignores: ['apps/mobile/src/components/shell/brand-mark.tsx'],
    rules: {
      'jsx-a11y/alt-text': 'off',
      'jsx-a11y/aria-role': 'off',
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
