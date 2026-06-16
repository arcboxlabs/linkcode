import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  // workspace 包以 TS 源码导出，必须打包进产物（不能作为运行时 external）。
  noExternal: [/^@linkcode\//],
});
