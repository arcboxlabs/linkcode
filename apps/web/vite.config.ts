import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  // Workspace packages are exported as TS source and transpiled on the fly by Vite/esbuild, so no prebundling is needed.
  optimizeDeps: { exclude: ['@linkcode/host', '@linkcode/client-core', '@linkcode/ui'] },
});
