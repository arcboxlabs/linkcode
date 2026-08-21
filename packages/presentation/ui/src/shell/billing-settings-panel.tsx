import { Button } from 'coss-ui/components/button';
import { Skeleton } from 'coss-ui/components/skeleton';
import { never } from 'foxts/guard';
import { useTranslations } from 'use-intl';
import { SettingsCard, SettingsSection } from './settings-page';

export type BillingBalanceView =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'missing-organization' }
  | { status: 'error' }
  | { status: 'ready'; amount: string; currency: 'USD' };

export interface BillingSettingsPanelProps {
  balance: BillingBalanceView;
  onSignIn?: () => void;
  onOpenBilling: () => void;
}

export function BillingSettingsPanel({
  balance,
  onSignIn,
  onOpenBilling,
}: BillingSettingsPanelProps): React.ReactNode {
  const t = useTranslations('settings.billing');

  return (
    <div className="flex flex-col gap-8">
      <p className="px-1 text-muted-foreground text-sm">{t('hostedHint')}</p>

      <SettingsSection title={t('creditsBalance')}>
        <div className="flex flex-col gap-3">
          <p className="px-1 text-muted-foreground text-xs">{t('description')}</p>
          <SettingsCard>
            <div className="flex items-center justify-between gap-6 px-4 py-4">
              <BalanceValue balance={balance} />
              {onSignIn && balance.status === 'signed-out' ? (
                <Button className="shrink-0" size="sm" variant="outline" onClick={onSignIn}>
                  {t('signIn')}
                </Button>
              ) : (
                <Button className="shrink-0" size="sm" variant="outline" onClick={onOpenBilling}>
                  {t('openOnWeb')}
                </Button>
              )}
            </div>
          </SettingsCard>
        </div>
      </SettingsSection>
    </div>
  );
}

function BalanceValue({ balance }: { balance: BillingBalanceView }): React.ReactNode {
  const t = useTranslations('settings.billing');

  switch (balance.status) {
    case 'loading':
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <Skeleton className="h-6 w-24" />
          <span className="text-muted-foreground text-xs">{t('availableBalance')}</span>
        </div>
      );
    case 'signed-out':
      return <p className="min-w-0 text-muted-foreground text-sm">{t('signedOut')}</p>;
    case 'missing-organization':
      return <p className="min-w-0 text-muted-foreground text-sm">{t('missingOrganization')}</p>;
    case 'error':
      return <p className="min-w-0 text-destructive text-sm">{t('loadError')}</p>;
    case 'ready':
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-medium text-xl tabular-nums">
            {balance.amount}{' '}
            <span className="font-normal text-muted-foreground text-sm">{balance.currency}</span>
          </p>
          <span className="text-muted-foreground text-xs">{t('availableBalance')}</span>
        </div>
      );
    default:
      return never(balance, 'billing balance view');
  }
}
