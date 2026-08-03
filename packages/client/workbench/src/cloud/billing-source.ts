import { z } from 'zod';
import type { CloudBillingOverview, CloudBillingSource } from './billing';

const organizationSchema = z.object({ id: z.uuid(), name: z.string(), slug: z.string() });
const moneyDisplaySchema = z.object({ currency: z.string(), amount: z.string() });
const summarySchema = z.object({
  denomination: z.literal('nano_usd'),
  availableAmount: z.string(),
  reservedAmount: z.string(),
  displayBalance: z.object({ currency: z.literal('USD'), amount: z.string() }),
});
const offersSchema = z.array(
  z.object({
    offerVersionId: z.uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    price: z.object({ currency: z.string(), amountMinor: z.string(), display: moneyDisplaySchema }),
    credits: z.object({
      denomination: z.literal('nano_usd'),
      amount: z.string(),
      display: moneyDisplaySchema,
      expiresAfterSeconds: z.number().nullable(),
    }),
  }),
);
const topUpOptionsSchema = z.array(
  z.object({
    offerVersionId: z.uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    currency: z.literal('usd'),
    minimumFaceAmountMinor: z.string(),
    minimumDisplay: moneyDisplaySchema,
    processingFeeBasisPoints: z.number(),
    processingFeeRefundable: z.literal(false),
    creditExpiresAfterSeconds: z.number().nullable(),
  }),
);
const ordersSchema = z.array(
  z.object({
    id: z.uuid(),
    currency: z.string(),
    priceAmountMinor: z.string(),
    creditFaceAmountMinor: z.string().nullable(),
    refundedAmountMinor: z.string(),
    status: z.enum([
      'pending',
      'paid',
      'payment_failed',
      'expired',
      'partially_refunded',
      'refunded',
    ]),
    createdAt: z.iso.datetime(),
  }),
);
const checkoutSchema = z.object({ checkoutUrl: z.url() });
const portalSchema = z.object({ portalUrl: z.url() });
const roleSchema = z.object({ role: z.string() });

/** Browser implementation: the ambient Better Auth cookie authenticates every request. */
export function createBrowserCloudBillingSource(apiUrl: string): CloudBillingSource {
  const call = (path: string, init?: RequestInit): Promise<Response> =>
    fetch(`${apiUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  const json = async <T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> => {
    const response = await call(path, init);
    if (!response.ok) throw new Error(`cloud billing ${path}: ${response.status}`);
    return schema.parse(await response.json());
  };
  return {
    async overview(): Promise<CloudBillingOverview> {
      const organization = await json('/organizations/default', organizationSchema, {
        method: 'POST',
      });
      await json('/auth/organization/set-active', organizationSchema, {
        method: 'POST',
        body: JSON.stringify({ organizationId: organization.id }),
      });
      const role = await json('/auth/organization/get-active-member-role', roleSchema);
      const base = `/organizations/${organization.id}/billing`;
      const [summary, offers, topUpOptions, orders] = await Promise.all([
        json(`${base}/summary`, summarySchema),
        json(`${base}/offers`, offersSchema),
        json(`${base}/top-up-options`, topUpOptionsSchema),
        json(`${base}/orders`, ordersSchema),
      ]);
      return {
        organization: { ...organization, role: role.role },
        summary,
        offers,
        topUpOptions,
        orders,
      };
    },
    async checkout(input): Promise<string> {
      const result = await json(
        `/organizations/${input.organizationId}/billing/checkout-sessions`,
        checkoutSchema,
        {
          method: 'POST',
          headers: { 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({
            offerVersionId: input.offerVersionId,
            currency: 'usd',
            creditFaceAmountMinor: input.creditFaceAmountMinor,
          }),
        },
      );
      return result.checkoutUrl;
    },
    async portal(): Promise<string | null> {
      const response = await call('/organizations/portal-sessions', { method: 'POST' });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`cloud billing portal: ${response.status}`);
      return portalSchema.parse(await response.json()).portalUrl;
    },
  };
}
