import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

// workspace 包以 TS 源码导出，需打包进 main/preload（不能作为运行时 external）。
const bundleWorkspace = {
  exclude: [
    '@linkcode/ipc',
    '@linkcode/schema',
    '@linkcode/transport',
    '@linkcode/host',
    '@linkcode/client-core',
    '@linkcode/ui',
  ],
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(bundleWorkspace)],
  },
  preload: {
    plugins: [externalizeDepsPlugin(bundleWorkspace)],
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
