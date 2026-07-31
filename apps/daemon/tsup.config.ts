import { defineConfig } from 'tsup';

export default defineConfig({
  // instrument.ts is a separate entry so it can be loaded via `node --import ./dist/instrument.js`
  // before the main bundle — Sentry must initialize before any instrumented module loads.
  entry: ['src/index.ts', 'src/instrument.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  // Desktop packaging copies only index.js; a split bundle misses chunk-*.js.
  splitting: false,
  // Stamp the channel into the bundle (CODE-460).
  define: { 'process.env.LINKCODE_BUILD_CHANNEL': JSON.stringify('release') },
  // Provide require() for inlined CJS deps (esbuild ESM has none).
  banner: {
    js: "import { createRequire as __linkcodeCreateRequire } from 'node:module'; const require = __linkcodeCreateRequire(import.meta.url);",
  },
  // Workspace TS source + daemon-only pure-JS deps (drizzle-orm, effect) must be bundled in.
  noExternal: [
    /^@linkcode\//,
    'drizzle-orm',
    /^effect(\/|$)/,
    /^@effect\/(?:opentelemetry|platform-node)(\/|$)/,
  ],
  // Agent SDKs ship native binaries and break if bundled; ws likewise.
  external: [
    '@anthropic-ai/claude-agent-sdk',
    '@openai/codex',
    '@opencode-ai/sdk',
    '@earendil-works/pi-coding-agent',
    'ws',
  ],
});
