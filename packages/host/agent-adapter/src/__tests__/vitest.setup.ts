import { vi } from 'vitest';

vi.mock('../shell-env', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAgentShellEnvironment: vi.fn(() =>
    Promise.resolve({
      PATH: '/project/bin',
      CODEX_HOME: '/project/codex',
      PROJECT_ENV: 'loaded',
    }),
  ),
}));
