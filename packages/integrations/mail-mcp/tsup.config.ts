import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  splitting: false,
  sourcemap: true,
  platform: 'node',
  // Installed plugin copies run without node_modules: bundle every dependency into one file.
  noExternal: [/.+/],
  define: { __MAIL_MCP_VERSION__: JSON.stringify(version) },
  banner: {
    // CJS deps (imapflow) keep their require() calls after bundling; give them a real require.
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
