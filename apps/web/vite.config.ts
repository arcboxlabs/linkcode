import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  server: { port: 5173 },
  // Workspace packages are exported as TS source and transpiled on the fly by Vite/esbuild, so no prebundling is needed.
  optimizeDeps: {
    exclude: ['@linkcode/client-core', '@linkcode/transport', '@linkcode/schema'],
  },
});
