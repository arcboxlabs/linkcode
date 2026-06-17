import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
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
    '@agentclientprotocol/sdk',
    'ws',
  ],
});
