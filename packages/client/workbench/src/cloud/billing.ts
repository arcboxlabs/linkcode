import type { SWRResponse } from 'swr';
import useSWR from 'swr';
import { z } from 'zod';

const nanoUsdAmountSchema = z.string().regex(/^-?\d+$/);

export const CloudBillingSummarySchema = z.object({
  denomination: z.literal('nano_usd'),
  availableAmount: nanoUsdAmountSchema,
  reservedAmount: z.string().regex(/^\d+$/),
  displayBalance: z.object({
    currency: z.literal('USD'),
    amount: z.string(),
  }),
});

export type CloudBillingSummary = z.infer<typeof CloudBillingSummarySchema>;

/** Returns null when the signed-in Cloud session has no active organization. */
export type CloudBillingSource = (scopeKey: string) => Promise<CloudBillingSummary | null>;

const BILLING_SUMMARY_KEY = 'cloud/billing/summary';

export function useCloudBillingSummary(
  scopeKey: string | null | undefined,
  source: CloudBillingSource | null,
): SWRResponse<CloudBillingSummary | null> {
  return useSWR<CloudBillingSummary | null>(
    scopeKey && source ? [BILLING_SUMMARY_KEY, scopeKey] : null,
    source ? ([, key]: [string, string]) => source(key) : null,
    { revalidateOnFocus: true },
  );
}
