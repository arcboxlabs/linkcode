import { getAgentCatalog } from '@linkcode/sdk';
import { ServiceIcon } from '@linkcode/ui';
import { useTranslations } from 'use-intl';
import { useData } from '../../runtime/tayori';

/**
 * Read-only "Local providers" block: custom providers scanned from pi's own models.json (the
 * `localProviders` field of the pi start catalog). Their models are already usable in pi
 * sessions; the definition lives in the agent's config file, so there is nothing to bind or edit
 * here — models.json stays the single source of truth. Renders nothing when the scan is empty.
 */
export function LocalProvidersSection(): React.ReactNode {
  const t = useTranslations('settings.providers.localProviders');
  const { data: catalog } = useData(getAgentCatalog, { agentKind: 'pi' });
  const providers = catalog?.localProviders ?? [];
  if (providers.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold text-sm">{t('title')}</h3>
        <p className="text-muted-foreground text-xs">{t('hint')}</p>
      </div>
      <ul className="flex flex-col gap-1">
        {providers.map((provider) => (
          <li
            key={provider.id}
            className="flex items-start gap-2.5 rounded-lg border border-border p-2.5"
          >
            <ServiceIcon service={undefined} label={provider.id} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium text-sm">{provider.id}</span>
                <span className="rounded-full border border-border px-1.5 text-[10px] text-muted-foreground leading-4">
                  {t('source')}
                </span>
              </span>
              {provider.baseUrl === undefined ? null : (
                <span className="block truncate text-muted-foreground text-xs">
                  {provider.baseUrl}
                </span>
              )}
              <span className="mt-1 flex flex-wrap gap-1">
                {provider.models.map((model) => (
                  <span
                    key={model}
                    className="rounded-full border border-border bg-background px-1.5 text-[10px] leading-4"
                  >
                    {model}
                  </span>
                ))}
              </span>
            </span>
            <span className="shrink-0 text-muted-foreground text-xs">
              {t('modelCount', { count: provider.models.length })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
