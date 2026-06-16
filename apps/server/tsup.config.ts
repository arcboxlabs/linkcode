import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  // Workspace packages are exported as TS source and must be bundled into the output (they cannot be treated as runtime externals).
  noExternal: [/^@linkcode\//],
});
