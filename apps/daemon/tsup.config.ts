import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  // Workspace packages are exported as TS source and must be bundled in. The agent SDKs (and `ws`) stay
  // external — they are real node_modules deps loaded at runtime (some spawn subprocesses / native bins).
  noExternal: [/^@linkcode\//],
});
