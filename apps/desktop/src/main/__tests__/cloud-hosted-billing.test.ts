import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  createApiKey: vi.fn(),
  getSession: vi.fn(),
  openExternal: vi.fn(),
  setAsDefaultProtocolClient: vi.fn(),
  setupMain: vi.fn(),
}));

vi.mock('@better-auth/electron/client', () => ({
  electronClient: () => ({}),
}));

vi.mock('@better-auth/api-key/client', () => ({
  apiKeyClient: () => ({}),
}));

vi.mock('better-auth/client/plugins', () => ({
  organizationClient: () => ({}),
}));

vi.mock('better-auth/client', () => ({
  createAuthClient: () => ({
    setupMain: mocks.setupMain,
    getSession: mocks.getSession,
    apiKey: { create: mocks.createApiKey },
  }),
}));

vi.mock('electron', () => ({
  app: {
    commandLine: {
      getSwitchValue: () => '',
      hasSwitch: () => false,
    },
    isPackaged: false,
    setAsDefaultProtocolClient: mocks.setAsDefaultProtocolClient,
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showErrorBox: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: () => unknown) => mocks.handlers.set(channel, handler),
  },
  shell: { openExternal: mocks.openExternal },
}));

vi.mock('../cloud-auth/storage', () => ({
  createSafeStorage: () => ({}),
}));

describe('desktop hosted billing handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.setAsDefaultProtocolClient.mockReturnValue(true);
    mocks.openExternal.mockResolvedValue(undefined);
    mocks.getSession.mockResolvedValue({
      data: { session: { activeOrganizationId: 'org_1' } },
      error: null,
    });
    mocks.createApiKey.mockResolvedValue({ data: { key: 'lc-gateway-secret' }, error: null });
  });

  it('opens the SDK URL with a channel-specific native return target', async () => {
    const { setupCloudAuth } = await import('../cloud-auth/client');
    const { CLOUD_OPEN_HOSTED_BILLING_CHANNEL } = await import('../../shared/cloud');
    setupCloudAuth();

    await mocks.handlers.get(CLOUD_OPEN_HOSTED_BILLING_CHANNEL)?.();

    expect(mocks.setAsDefaultProtocolClient).toHaveBeenCalled();
    expect(mocks.openExternal).toHaveBeenCalledWith(
      'https://console.linkcode.ai/billing?returnTarget=linkcode-dev%3A%2F%2Fbilling%2Freturn',
    );
  });

  it('mints a Gateway key in the signed-in session organization', async () => {
    const { setupCloudAuth } = await import('../cloud-auth/client');
    const { CLOUD_CREATE_GATEWAY_KEY_CHANNEL } = await import('../../shared/cloud');
    setupCloudAuth();

    await expect(
      mocks.handlers.get(CLOUD_CREATE_GATEWAY_KEY_CHANNEL)?.({}, 'LinkCode Gateway'),
    ).resolves.toBe('lc-gateway-secret');
    expect(mocks.createApiKey).toHaveBeenCalledWith({
      name: 'LinkCode Gateway',
      organizationId: 'org_1',
    });
  });
});
