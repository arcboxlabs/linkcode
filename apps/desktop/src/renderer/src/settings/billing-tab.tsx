import { BillingSettingsPanel } from '@linkcode/ui';
import { cloudDataBridge } from '../cloud-auth/bridges';

export function BillingTab(): React.ReactNode {
  return (
    <BillingSettingsPanel
      onOpenBilling={() => {
        void cloudDataBridge.openHostedBilling();
      }}
    />
  );
}
