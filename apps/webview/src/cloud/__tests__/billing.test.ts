import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('../auth', () => ({ CLOUD_API_URL: 'https://api.linkcode.test' }));

import { fetchCloudBillingSummary } from '../billing';

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.fetch.mockReset();
});

describe('browser Cloud billing source', () => {
  it('fetches and validates the organization balance with the session cookie', async () => {
    const summary = {
      denomination: 'nano_usd',
      availableAmount: '-500000000',
      reservedAmount: '0',
      displayBalance: { currency: 'USD', amount: '-0.50' },
    };
    mocks.fetch.mockResolvedValue(Response.json(summary, { status: 200 }));
    vi.stubGlobal('fetch', mocks.fetch);

    await expect(fetchCloudBillingSummary('org/1')).resolves.toEqual(summary);
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.linkcode.test/organizations/org%2F1/billing/summary',
      { credentials: 'include' },
    );
  });

  it('rejects a malformed raw balance', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json(
        {
          denomination: 'nano_usd',
          availableAmount: 12_500_000_000,
          reservedAmount: '0',
          displayBalance: { currency: 'USD', amount: '12.50' },
        },
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', mocks.fetch);

    await expect(fetchCloudBillingSummary('org_1')).rejects.toThrow();
  });
});
