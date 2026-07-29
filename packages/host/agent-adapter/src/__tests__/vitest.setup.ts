import { vi } from 'vitest';

vi.mock('../shell-env', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAgentShellEnvironment: () =>
    Promise.resolve({ PATH: '/project/bin', PROJECT_ENV: 'loaded' }),
}));
