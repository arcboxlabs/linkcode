import { Button } from 'coss-ui/components/button';
import { Card, CardPanel } from 'coss-ui/components/card';
import { ExternalLinkIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';

export interface BillingSettingsPanelProps {
  onOpenBilling: () => void;
}

export function BillingSettingsPanel({
  onOpenBilling,
}: BillingSettingsPanelProps): React.ReactNode {
  const t = useTranslations('settings.billing');

  return (
    <Card>
      <CardPanel className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0 space-y-1">
          <p className="text-sm">{t('description')}</p>
          <p className="text-muted-foreground text-xs">{t('hostedHint')}</p>
        </div>
        <Button className="shrink-0" size="sm" onClick={onOpenBilling}>
          <ExternalLinkIcon />
          {t('openOnWeb')}
        </Button>
      </CardPanel>
    </Card>
  );
}
