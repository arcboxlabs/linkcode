import { createHostedBillingUrl } from '@linkcode/cloud';
import type { BillingBalanceView } from '@linkcode/ui';
import { BillingSettingsPanel } from '@linkcode/ui';
import { useCloudBillingSummary } from '@linkcode/workbench';
import { authClient, signInWithCloud } from '@webview/cloud/auth';
import { fetchCloudBillingSummary } from '@webview/cloud/billing';

const HOSTED_BILLING_URL = createHostedBillingUrl();

export function BillingSettings(): React.ReactNode {
  const session = authClient.useSession();
  const organizationId = session.data?.session.activeOrganizationId;
  const summary = useCloudBillingSummary(organizationId, fetchCloudBillingSummary);
  let balance: BillingBalanceView;
  if (session.isPending) balance = { status: 'loading' };
  else if (!session.data) balance = { status: 'signed-out' };
  else if (!organizationId) balance = { status: 'missing-organization' };
  else if (summary.data === undefined) {
    balance = { status: summary.error === undefined ? 'loading' : 'error' };
  } else if (summary.data === null) balance = { status: 'missing-organization' };
  else {
    balance = {
      status: 'ready',
      amount: summary.data.displayBalance.amount,
      currency: summary.data.displayBalance.currency,
    };
  }

  return (
    <BillingSettingsPanel
      balance={balance}
      onSignIn={signInWithCloud}
      onOpenBilling={() => {
        window.open(HOSTED_BILLING_URL, '_blank', 'noopener,noreferrer');
      }}
    />
  );
}
