import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // workspace 包以 TS 源码形式导出，交给 Vite/esbuild 即时转译，无需预构建。
  optimizeDeps: { exclude: ['@linkcode/host', '@linkcode/client-core', '@linkcode/ui'] },
});
