import { noop } from 'foxact/noop';
import { createContext, use, useCallback } from 'react';
import type { SWRResponse } from 'swr';
import useSWR, { useSWRConfig } from 'swr';

export interface CloudBillingOrganization {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface CloudBillingSummary {
  denomination: 'nano_usd';
  availableAmount: string;
  reservedAmount: string;
  displayBalance: { currency: 'USD'; amount: string };
}

export interface CloudBillingOffer {
  offerVersionId: string;
  code: string;
  name: string;
  description: string | null;
  price: {
    currency: string;
    amountMinor: string;
    display: { currency: string; amount: string };
  };
  credits: {
    denomination: 'nano_usd';
    amount: string;
    display: { currency: string; amount: string };
    expiresAfterSeconds: number | null;
  };
}

export interface CloudBillingTopUpOption {
  offerVersionId: string;
  code: string;
  name: string;
  description: string | null;
  currency: 'usd';
  minimumFaceAmountMinor: string;
  minimumDisplay: { currency: string; amount: string };
  processingFeeBasisPoints: number;
  processingFeeRefundable: false;
  creditExpiresAfterSeconds: number | null;
}

export type CloudBillingOrderStatus =
  | 'pending'
  | 'paid'
  | 'payment_failed'
  | 'expired'
  | 'partially_refunded'
  | 'refunded';

export interface CloudBillingOrder {
  id: string;
  currency: string;
  priceAmountMinor: string;
  creditFaceAmountMinor: string | null;
  refundedAmountMinor: string;
  status: CloudBillingOrderStatus;
  createdAt: string;
}

export interface CloudBillingOverview {
  organization: CloudBillingOrganization;
  summary: CloudBillingSummary;
  offers: CloudBillingOffer[];
  topUpOptions: CloudBillingTopUpOption[];
  orders: CloudBillingOrder[];
}

export interface CloudBillingCheckoutInput {
  organizationId: string;
  offerVersionId: string;
  creditFaceAmountMinor?: string;
}

export interface CloudBillingSource {
  overview: () => Promise<CloudBillingOverview>;
  checkout: (input: CloudBillingCheckoutInput) => Promise<string>;
  portal: () => Promise<string | null>;
}

const CloudBillingSourceContext = createContext<CloudBillingSource | null>(null);

export function CloudBillingProvider({
  source,
  children,
}: {
  source: CloudBillingSource;
  children?: React.ReactNode;
}): React.ReactNode {
  return <CloudBillingSourceContext value={source}>{children}</CloudBillingSourceContext>;
}

const BILLING_OVERVIEW_KEY = 'cloud/billing/overview';

export function useCloudBilling(
  accountKey: string | null | undefined,
): SWRResponse<CloudBillingOverview> {
  const source = use(CloudBillingSourceContext);
  return useSWR<CloudBillingOverview>(
    accountKey && source ? [BILLING_OVERVIEW_KEY, accountKey] : null,
    source ? source.overview : null,
    { revalidateOnFocus: true },
  );
}

export interface CloudBillingActions {
  checkout: (input: CloudBillingCheckoutInput) => Promise<string>;
  portal: () => Promise<string | null>;
}

export function useCloudBillingActions(): CloudBillingActions | null {
  const source = use(CloudBillingSourceContext);
  const { mutate } = useSWRConfig();
  const invalidate = useCallback(
    () => mutate((key) => Array.isArray(key) && key[0] === BILLING_OVERVIEW_KEY),
    [mutate],
  );
  const checkout = useCallback(
    async (input: CloudBillingCheckoutInput) => {
      if (!source) throw new Error('CloudBillingProvider missing');
      const url = await source.checkout(input);
      invalidate().catch(noop);
      return url;
    },
    [source, invalidate],
  );
  const portal = useCallback(async () => {
    if (!source) throw new Error('CloudBillingProvider missing');
    return source.portal();
  }, [source]);

  return source ? { checkout, portal } : null;
}

export function canManageCloudBilling(role: string): boolean {
  return role.split(',').some((value) => {
    const normalized = value.trim();
    return normalized === 'owner' || normalized === 'admin';
  });
}
