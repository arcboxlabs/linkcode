import { Button } from 'coss-ui/components/button';
import { Card, CardPanel } from 'coss-ui/components/card';
import { Skeleton } from 'coss-ui/components/skeleton';
import { never } from 'foxts/guard';
import { ExternalLinkIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';

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
    <Card>
      <CardPanel className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm">{t('description')}</p>
            <p className="text-muted-foreground text-xs">{t('hostedHint')}</p>
          </div>
          <Button className="shrink-0" size="sm" onClick={onOpenBilling}>
            <ExternalLinkIcon />
            {t('openOnWeb')}
          </Button>
        </div>
        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="mb-2 text-muted-foreground text-xs">{t('availableBalance')}</p>
          <BalanceValue balance={balance} onSignIn={onSignIn} />
        </div>
      </CardPanel>
    </Card>
  );
}

function BalanceValue({
  balance,
  onSignIn,
}: {
  balance: BillingBalanceView;
  onSignIn?: () => void;
}): React.ReactNode {
  const t = useTranslations('settings.billing');

  switch (balance.status) {
    case 'loading':
      return <Skeleton className="h-8 w-32" />;
    case 'signed-out':
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground text-sm">{t('signedOut')}</p>
          {onSignIn ? (
            <Button size="sm" onClick={onSignIn}>
              {t('signIn')}
            </Button>
          ) : null}
        </div>
      );
    case 'missing-organization':
      return <p className="text-muted-foreground text-sm">{t('missingOrganization')}</p>;
    case 'error':
      return <p className="text-destructive text-sm">{t('loadError')}</p>;
    case 'ready':
      return (
        <p className="font-medium text-2xl tabular-nums">
          {balance.amount}{' '}
          <span className="font-normal text-muted-foreground text-sm">{balance.currency}</span>
        </p>
      );
    default:
      return never(balance, 'billing balance view');
  }
}
