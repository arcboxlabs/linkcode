import { defineConfig } from 'tsup';

export default defineConfig({
  // instrument.ts is a separate entry so it can be loaded via `node --import ./dist/instrument.js`
  // before the main bundle — Sentry must initialize before any instrumented module loads.
  entry: ['src/index.ts', 'src/instrument.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  // Desktop packaging copies only index.js into the asar (electron.vite.config.ts
  // bundle-daemon-artifact); a split bundle boots to ERR_MODULE_NOT_FOUND on the missing chunk-*.js.
  splitting: false,
  // Inlined CJS deps call `require()`; esbuild's ESM output has none, so provide one or boot dies
  // with "Dynamic require of ... is not supported". The private alias avoids redeclaring a bundled
  // module's own preserved `import { createRequire }` (the banner is prepended after esbuild).
  banner: {
    js: "import { createRequire as __linkcodeCreateRequire } from 'node:module'; const require = __linkcodeCreateRequire(import.meta.url);",
  },
  // Workspace packages are exported as TS source and must be bundled in. drizzle-orm is bundled
  // too (it's pure JS and daemon-only, and lives in devDependencies): keeping it external would
  // put its whole 15 MB dual-format dist into both deploy closures (desktop asar + standalone)
  // when the bundle only uses the better-sqlite3 dialect.
  // effect + its daemon integrations follow the same pattern: pure JS, daemon-only,
  // devDependencies, bundled in so neither deploy closure has to carry them (CODE-244).
  noExternal: [
    /^@linkcode\//,
    'drizzle-orm',
    /^effect(\/|$)/,
    /^@effect\/(?:opentelemetry|platform-node)(\/|$)/,
  ],
  // The agent SDKs are pulled in (lazily) via @linkcode/agent-adapter, but must stay external: several
  // ship platform-specific native binaries / spawn subprocesses and break if bundled. They load from
  // node_modules at runtime. `ws` (via @linkcode/transport/server) is externalized for the same reason.
  external: [
    '@anthropic-ai/claude-agent-sdk',
    '@openai/codex',
    '@opencode-ai/sdk',
    '@earendil-works/pi-coding-agent',
    'ws',
  ],
});
