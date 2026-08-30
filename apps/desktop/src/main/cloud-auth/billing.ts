import type { CloudBillingSummary } from '@linkcode/workbench';
import { ipcMain } from 'electron';
import { z } from 'zod';
import { CLOUD_GET_BILLING_SUMMARY_CHANNEL } from '../../shared/cloud';
import { authClient, CLOUD_API_URL } from './client';

const billingSummarySchema = z.object({
  denomination: z.literal('nano_usd'),
  availableAmount: z.string().regex(/^-?\d+$/),
  reservedAmount: z.string().regex(/^\d+$/),
  displayBalance: z.object({
    currency: z.literal('USD'),
    amount: z.string(),
  }),
});

export async function getCloudBillingSummary(): Promise<CloudBillingSummary | null> {
  const session = await authClient.getSession();
  if (session.error) throw new Error(session.error.message);
  const organizationId = session.data?.session.activeOrganizationId;
  if (!organizationId) return null;

  const res = await fetch(
    `${CLOUD_API_URL}/organizations/${encodeURIComponent(organizationId)}/billing/summary`,
    { headers: { cookie: authClient.getCookie() } },
  );
  if (!res.ok) throw new Error(`getCloudBillingSummary: ${res.status} ${res.statusText}`);
  return billingSummarySchema.parse(await res.json());
}

export function registerCloudBillingBridge(): void {
  ipcMain.handle(CLOUD_GET_BILLING_SUMMARY_CHANNEL, () => getCloudBillingSummary());
}
