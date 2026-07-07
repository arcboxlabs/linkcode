import { defineConfig } from 'tsup';

export default defineConfig({
  // instrument.ts is a separate entry so it can be loaded via `node --import ./dist/instrument.js`
  // before the main bundle — Sentry must initialize before any instrumented module loads.
  entry: ['src/index.ts', 'src/instrument.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  // Inlined CJS deps (socket.io's tree) call `require()` at runtime; esbuild's ESM output has no
  // implicit require, so provide one or the bundle dies on boot with "Dynamic require of ... is
  // not supported".
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  // Workspace packages are exported as TS source and must be bundled in.
  noExternal: [/^@linkcode\//],
  // The agent SDKs are pulled in (lazily) via @linkcode/agent-adapter, but must stay external: several
  // ship platform-specific native binaries / spawn subprocesses and break if bundled. They load from
  // node_modules at runtime. `ws` (via @linkcode/transport/server) is externalized for the same reason.
  external: [
    '@anthropic-ai/claude-agent-sdk',
    '@openai/codex-sdk',
    '@opencode-ai/sdk',
    '@earendil-works/pi-coding-agent',
    'ws',
  ],
});
