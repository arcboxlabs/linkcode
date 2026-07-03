'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { createTypeScriptImportResolver } = require('eslint-import-resolver-typescript');

const tsconfigProjects = [
  path.join(__dirname, 'tsconfig.base.json'),
  ...workspaceTsconfigs('apps'),
  ...workspaceTsconfigs('packages'),
];

function workspaceTsconfigs(dir) {
  return fs
    .readdirSync(path.join(__dirname, dir), { withFileTypes: true })
    .reduce((configs, entry) => {
      if (!entry.isDirectory()) return configs;
      const tsconfig = path.join(__dirname, dir, entry.name, 'tsconfig.json');
      if (fs.existsSync(tsconfig)) configs.push(tsconfig);
      return configs;
    }, []);
}

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
        // apps/daemon/drizzle.config.ts is intentionally absent: it is included by the daemon's
        // tsconfig (project service), and a file must not appear in both.
        'apps/*/vite.config.ts',
        'apps/*/tsup.config.ts',
        'apps/desktop/electron.vite.config.ts',
        // agent-adapter tests are included by that package's tsconfig like every other package's;
        // listing them here too would breach typescript-eslint's 8-file default-project cap.
        'vitest.config.ts',
      ],
    },
  },
  {
    name: 'linkcode/import-resolver',
    settings: {
      'import-x/resolver': {
        typescript: {
          noWarnOnMultipleProjects: true,
          project: tsconfigProjects,
        },
      },
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          noWarnOnMultipleProjects: true,
          project: tsconfigProjects,
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
