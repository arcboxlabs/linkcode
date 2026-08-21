import type { WorkspaceScript } from '@linkcode/schema';

/** Baseline declared scripts every mock workspace exposes (state lives in the host). */
export function mockScriptDeclarations(): WorkspaceScript[] {
  return [
    {
      scriptName: 'web',
      type: 'service',
      command: 'pnpm dev',
      lifecycle: 'idle',
      health: 'unknown',
      port: 5173,
      hostname: 'web--mock-000000.localhost',
      // example.com so the mock's "open preview" flows render a real page without a daemon.
      localProxyUrl: 'https://example.com',
    },
    {
      scriptName: 'test',
      type: 'task',
      command: 'pnpm vitest run',
      lifecycle: 'idle',
      health: 'unknown',
    },
  ];
}
