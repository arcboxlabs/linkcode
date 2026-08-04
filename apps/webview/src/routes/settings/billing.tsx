import { createHostedBillingUrl } from '@linkcode/cloud';
import { BillingSettingsPanel } from '@linkcode/ui';

const HOSTED_BILLING_URL = createHostedBillingUrl();

export function BillingSettings(): React.ReactNode {
  return (
    <BillingSettingsPanel
      onOpenBilling={() => {
        window.open(HOSTED_BILLING_URL, '_blank', 'noopener,noreferrer');
      }}
    />
  );
}
