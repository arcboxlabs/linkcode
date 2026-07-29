import { vi } from 'vitest';

vi.mock('../process-environment', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAgentProcessEnvironment: () =>
    Promise.resolve({ PATH: '/project/bin', PROJECT_ENV: 'loaded' }),
}));
