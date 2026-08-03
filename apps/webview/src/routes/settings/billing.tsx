import type { BillingSettingsDataView } from '@linkcode/ui';
import { BillingSettingsPanel } from '@linkcode/ui';
import {
  canManageCloudBilling,
  useCloudBilling,
  useCloudBillingActions,
} from '@linkcode/workbench';
import { authClient, signInWithCloud } from '@webview/cloud/auth';
import { extractErrorMessage } from 'foxts/extract-error-message';

export function BillingSettings(): React.ReactNode {
  const session = authClient.useSession();
  const billing = useCloudBilling(session.data?.user.email ?? null);
  const actions = useCloudBillingActions();
  const data = billing.data ? toView(billing.data) : undefined;

  const checkout = async (
    offerVersionId: string,
    creditFaceAmountMinor?: string,
  ): Promise<void> => {
    if (!actions || !billing.data) throw new Error('cloud billing source missing');
    const pendingTab = window.open('about:blank', '_blank');
    try {
      const url = await actions.checkout({
        organizationId: billing.data.organization.id,
        offerVersionId,
        creditFaceAmountMinor,
      });
      if (pendingTab) {
        pendingTab.opener = null;
        pendingTab.location.assign(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      pendingTab?.close();
      throw error;
    }
  };
  const manageSubscription = async (): Promise<boolean> => {
    if (!actions) throw new Error('cloud billing source missing');
    const url = await actions.portal();
    if (url === null) return false;
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  };

  return (
    <BillingSettingsPanel
      signedIn={session.data !== null}
      onSignIn={signInWithCloud}
      data={data}
      error={
        billing.error === undefined
          ? null
          : (extractErrorMessage(billing.error, false) ?? String(billing.error))
      }
      onCheckout={checkout}
      onManageSubscription={manageSubscription}
    />
  );
}

function toView(
  data: NonNullable<ReturnType<typeof useCloudBilling>['data']>,
): BillingSettingsDataView {
  return {
    organizationName: data.organization.name,
    canManage: canManageCloudBilling(data.organization.role),
    availableNanoUsd: data.summary.availableAmount,
    reservedNanoUsd: data.summary.reservedAmount,
    offers: data.offers.map((offer) => ({
      id: offer.offerVersionId,
      name: offer.name,
      description: offer.description,
      price: offer.price.display,
      credits: offer.credits.display,
    })),
    topUpOptions: data.topUpOptions.map((option) => ({
      id: option.offerVersionId,
      name: option.name,
      description: option.description,
      minimumAmountMinor: option.minimumFaceAmountMinor,
      minimum: option.minimumDisplay,
      feeBasisPoints: option.processingFeeBasisPoints,
    })),
    orders: data.orders.map((order) => ({
      id: order.id,
      currency: order.currency,
      amountMinor: order.priceAmountMinor,
      refundedAmountMinor: order.refundedAmountMinor,
      status: order.status,
      createdAt: order.createdAt,
    })),
  };
}
