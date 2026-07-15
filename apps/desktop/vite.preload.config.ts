import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { NODE_TARGET, nodeExternals, processEnvDefine } from './vite.shared';

export default defineConfig({
  root: __dirname,
  define: processEnvDefine,
  envPrefix: ['PRELOAD_VITE_', 'VITE_'],
  resolve: {
    mainFields: ['browser', 'module', 'jsnext:main', 'jsnext'],
  },
  ssr: {
    noExternal: true,
    resolve: {
      conditions: ['module', 'browser', 'development|production'],
    },
  },
  build: {
    ssr: true,
    ssrEmitAssets: true,
    target: NODE_TARGET,
    outDir: 'out/preload',
    assetsDir: 'chunks',
    lib: {
      entry: resolve(__dirname, 'src/preload/index.ts'),
      formats: ['cjs'],
    },
    rollupOptions: {
      // The preload runs sandboxed and cannot `require()` external node_modules at runtime, so the
      // better-auth electron bridge must be bundled in, not externalized (unlike in main).
      external: nodeExternals(['@better-auth/electron']),
      output: {
        entryFileNames: '[name].js',
        assetFileNames: 'chunks/[name]-[hash][extname]',
      },
    },
    minify: false,
    modulePreload: false,
    copyPublicDir: false,
    reportCompressedSize: false,
  },
});
