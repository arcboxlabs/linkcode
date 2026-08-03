import { afterEach, describe, expect, it, vi } from 'vitest';
import { canManageCloudBilling } from '../billing';
import { createBrowserCloudBillingSource } from '../billing-source';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

afterEach(() => vi.unstubAllGlobals());

describe('canManageCloudBilling', () => {
  it('matches the server owner/admin gate, including comma-separated roles', () => {
    expect(canManageCloudBilling('owner')).toBe(true);
    expect(canManageCloudBilling('member, admin')).toBe(true);
    expect(canManageCloudBilling(' member , owner ')).toBe(true);
    expect(canManageCloudBilling('member')).toBe(false);
    expect(canManageCloudBilling('administrator')).toBe(false);
  });
});

describe('createBrowserCloudBillingSource', () => {
  it('surfaces a missing catalog endpoint instead of misreporting an empty catalog', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ id: ORGANIZATION_ID, name: 'LinkCode', slug: 'linkcode' }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ id: ORGANIZATION_ID, name: 'LinkCode', slug: 'linkcode' }),
        )
        .mockResolvedValueOnce(jsonResponse({ role: 'owner' }))
        .mockResolvedValueOnce(
          jsonResponse({
            denomination: 'nano_usd',
            availableAmount: '0',
            reservedAmount: '0',
            displayBalance: { currency: 'USD', amount: '0.00' },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404))
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse([])),
    );

    await expect(
      createBrowserCloudBillingSource('https://example.test').overview(),
    ).rejects.toThrow(`/organizations/${ORGANIZATION_ID}/billing/offers: 404`);
  });

  it('reports a missing billing profile without throwing an opaque portal error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404)),
    );

    await expect(
      createBrowserCloudBillingSource('https://example.test').portal(),
    ).resolves.toBeNull();
  });
});
