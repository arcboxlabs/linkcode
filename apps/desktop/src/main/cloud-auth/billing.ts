import { randomUUID } from 'node:crypto';
import type { CloudBillingOverview } from '@linkcode/workbench';
import { ipcMain } from 'electron';
import { z } from 'zod';
import {
  CLOUD_BILLING_CHECKOUT_CHANNEL,
  CLOUD_BILLING_OVERVIEW_CHANNEL,
  CLOUD_BILLING_PORTAL_CHANNEL,
} from '../../shared/cloud';
import { authClient, CLOUD_API_URL } from './client';

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
const checkoutInputSchema = z.object({
  organizationId: z.uuid(),
  offerVersionId: z.uuid(),
  creditFaceAmountMinor: z
    .string()
    .regex(/^[1-9]\d{0,7}$/)
    .optional(),
});
const checkoutSchema = z.object({ checkoutUrl: z.url() });
const portalSchema = z.object({ portalUrl: z.url() });

function cloudFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${CLOUD_API_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, cookie: authClient.getCookie() },
  });
}

async function cloudJson<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await cloudFetch(path, init);
  if (!response.ok) throw new Error(`cloud billing ${path}: ${response.status}`);
  return schema.parse(await response.json());
}

async function getBillingOverview(): Promise<CloudBillingOverview> {
  const organization = await cloudJson('/organizations/default', organizationSchema, {
    method: 'POST',
  });
  const active = await authClient.organization.setActive({ organizationId: organization.id });
  if (active.error) throw new Error(`activate billing organization: ${active.error.status}`);
  const memberRole = await authClient.organization.getActiveMemberRole();
  if (memberRole.error || !memberRole.data) {
    throw new Error(`get billing role: ${memberRole.error?.status ?? 'empty response'}`);
  }
  const base = `/organizations/${organization.id}/billing`;
  const [summary, offers, topUpOptions, orders] = await Promise.all([
    cloudJson(`${base}/summary`, summarySchema),
    cloudJson(`${base}/offers`, offersSchema),
    cloudJson(`${base}/top-up-options`, topUpOptionsSchema),
    cloudJson(`${base}/orders`, ordersSchema),
  ]);
  return {
    organization: { ...organization, role: memberRole.data.role },
    summary,
    offers,
    topUpOptions,
    orders,
  };
}

async function createCheckout(input: z.infer<typeof checkoutInputSchema>): Promise<string> {
  const result = await cloudJson(
    `/organizations/${input.organizationId}/billing/checkout-sessions`,
    checkoutSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({
        offerVersionId: input.offerVersionId,
        currency: 'usd',
        creditFaceAmountMinor: input.creditFaceAmountMinor,
      }),
    },
  );
  return result.checkoutUrl;
}

async function createPortal(): Promise<string | null> {
  const response = await cloudFetch('/organizations/portal-sessions', {
    method: 'POST',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`cloud billing portal: ${response.status}`);
  return portalSchema.parse(await response.json()).portalUrl;
}

export function registerCloudBillingBridge(): void {
  ipcMain.handle(CLOUD_BILLING_OVERVIEW_CHANNEL, () => getBillingOverview());
  ipcMain.handle(CLOUD_BILLING_CHECKOUT_CHANNEL, (_event, input: unknown) =>
    createCheckout(checkoutInputSchema.parse(input)),
  );
  ipcMain.handle(CLOUD_BILLING_PORTAL_CHANNEL, () => createPortal());
}
