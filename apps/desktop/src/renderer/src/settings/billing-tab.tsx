import type { BillingBalanceView } from '@linkcode/ui';
import { BillingSettingsPanel } from '@linkcode/ui';
import { useCloudBillingSummary } from '@linkcode/workbench';
import { cloudDataBridge } from '../cloud-auth/bridges';
import { useCloudAccount } from '../cloud-auth/use-cloud-account';

const getBillingSummary = () => cloudDataBridge.billingSummary();

export function BillingTab(): React.ReactNode {
  const cloud = useCloudAccount();
  const summary = useCloudBillingSummary(cloud.account?.email, getBillingSummary);
  let balance: BillingBalanceView;
  if (!cloud.loaded) balance = { status: 'loading' };
  else if (!cloud.account) balance = { status: 'signed-out' };
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
      onSignIn={cloud.signIn}
      onOpenBilling={() => {
        void cloudDataBridge.openHostedBilling();
      }}
    />
  );
}
