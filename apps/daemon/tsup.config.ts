import { defineConfig } from 'tsup';

export default defineConfig({
  // instrument.ts is a separate entry so it can be loaded via `node --import ./dist/instrument.js`
  // before the main bundle — Sentry must initialize before any instrumented module loads.
  entry: ['src/index.ts', 'src/instrument.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  // Each entry must be a single self-contained file. tsup splits ESM by default, hoisting shared and
  // dynamically-imported modules (e.g. p-map, reached via @linkcode/assets) into sibling chunk-*.js
  // files — but the desktop packaging copies only index.js into the asar (electron.vite.config.ts
  // bundle-daemon-artifact), so a split bundle boots to ERR_MODULE_NOT_FOUND on the missing chunk.
  splitting: false,
  // Inlined CJS deps (socket.io's tree) call `require()` at runtime; esbuild's ESM output has no
  // implicit require, so provide one or the bundle dies on boot with "Dynamic require of ... is
  // not supported". The import binding carries a private alias: the banner is prepended AFTER
  // esbuild, so a bundled module's own preserved `import { createRequire }` would otherwise
  // redeclare the identifier and kill the boot.
  banner: {
    js: "import { createRequire as __linkcodeCreateRequire } from 'node:module'; const require = __linkcodeCreateRequire(import.meta.url);",
  },
  // Workspace packages are exported as TS source and must be bundled in.
  noExternal: [/^@linkcode\//],
  // The agent SDKs are pulled in (lazily) via @linkcode/agent-adapter, but must stay external: several
  // ship platform-specific native binaries / spawn subprocesses and break if bundled. They load from
  // node_modules at runtime. `ws` (via @linkcode/transport/server) is externalized for the same reason.
  external: [
    '@sourcegraph/amp-sdk',
    '@anthropic-ai/claude-agent-sdk',
    '@openai/codex',
    '@opencode-ai/sdk',
    '@earendil-works/pi-coding-agent',
    'ws',
  ],
});
