import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';

// Placeholder until the daemon-owned provider config lands (Phase 3): the real UI reads/writes
// per-agent config over the data-plane transport (config.get / config.set).
export function AgentsTab(): ReactNode {
  const t = useTranslations('settings.agents');
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-semibold text-sm">{t('title')}</h2>
      <p className="text-muted-foreground text-xs">{t('hint')}</p>
      <p className="mt-4 text-muted-foreground text-sm">{t('unavailable')}</p>
    </div>
  );
}
