import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, () => unknown>(),
  fetch: vi.fn(),
  getCookie: vi.fn(() => 'better-auth.session=token'),
  getSession: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: () => unknown) => mocks.handlers.set(channel, handler),
  },
}));

vi.mock('../cloud-auth/client', () => ({
  authClient: {
    getCookie: mocks.getCookie,
    getSession: mocks.getSession,
  },
  CLOUD_API_URL: 'https://api.linkcode.test',
}));

const summary = {
  denomination: 'nano_usd',
  availableAmount: '12500000000',
  reservedAmount: '500000000',
  displayBalance: { currency: 'USD', amount: '12.50' },
};

beforeEach(() => {
  mocks.handlers.clear();
  mocks.fetch.mockReset();
  mocks.getSession.mockReset();
  mocks.getSession.mockResolvedValue({
    data: { session: { activeOrganizationId: 'org/1' } },
    error: null,
  });
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => vi.unstubAllGlobals());

describe('desktop Cloud billing bridge', () => {
  it('reads and validates the active organization balance with the main-process session', async () => {
    mocks.fetch.mockResolvedValue(Response.json(summary, { status: 200, statusText: 'OK' }));
    const { registerCloudBillingBridge } = await import('../cloud-auth/billing');
    const { CLOUD_GET_BILLING_SUMMARY_CHANNEL } = await import('../../shared/cloud');
    registerCloudBillingBridge();

    await expect(mocks.handlers.get(CLOUD_GET_BILLING_SUMMARY_CHANNEL)?.()).resolves.toEqual(
      summary,
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.linkcode.test/organizations/org%2F1/billing/summary',
      { headers: { cookie: 'better-auth.session=token' } },
    );
  });

  it('returns null without an active organization', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: {} }, error: null });
    const { getCloudBillingSummary } = await import('../cloud-auth/billing');

    await expect(getCloudBillingSummary()).resolves.toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects a non-integer nano-USD balance', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ ...summary, availableAmount: '12.50' }, { status: 200 }),
    );
    const { getCloudBillingSummary } = await import('../cloud-auth/billing');

    await expect(getCloudBillingSummary()).rejects.toThrow();
  });
});
