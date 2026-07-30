import type { PluginScope } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Card } from 'coss-ui/components/card';
import { Switch } from 'coss-ui/components/switch';
import { useTranslations } from 'use-intl';
import { AgentIcon } from '../../chat/agent-icon';
import type { PluginCardView, PluginInstallationRow } from './types';

export interface PluginCardProps {
  card: PluginCardView;
  busy: boolean;
  /** False in the market list, where "not installed" is true of every entry and pure noise. */
  showInstallState?: boolean;
  onToggleInstallation: (
    card: PluginCardView,
    scope: PluginScope | undefined,
    enabled: boolean,
  ) => void;
}

/** One provider plugin: identity, capability summary, and per-installation enablement. */
export function PluginCard({
  card,
  busy,
  showInstallState = true,
  onToggleInstallation,
}: PluginCardProps): React.ReactNode {
  const t = useTranslations('settings.plugins');
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <AgentIcon kind={card.provider} className="mt-0.5 size-5 shrink-0" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-sm">{card.title}</span>
              {card.version === undefined ? null : (
                <span className="text-label-tertiary text-2xs tabular-nums">v{card.version}</span>
              )}
              {card.availability === 'available' ? null : (
                <Badge variant="warning">{t(`availability.${card.availability}`)}</Badge>
              )}
              {!showInstallState || card.installed ? null : (
                <Badge variant="secondary">{t('notInstalled')}</Badge>
              )}
            </div>
            {card.description === undefined ? null : (
              <p className="line-clamp-2 text-muted-foreground text-xs">{card.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-label-tertiary">
              {card.marketplaceLabel === undefined ? null : <span>{card.marketplaceLabel}</span>}
              <ComponentSummary counts={card.componentCounts} />
            </div>
          </div>
        </div>
      </div>
      {card.installations.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          {card.installations.map((installation) => (
            <InstallationRow
              key={`${installation.scope ?? 'unscoped'}:${installation.version ?? ''}`}
              busy={busy}
              installation={installation}
              onToggle={(enabled) => onToggleInstallation(card, installation.scope, enabled)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function InstallationRow({
  installation,
  busy,
  onToggle,
}: {
  installation: PluginInstallationRow;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
}): React.ReactNode {
  const t = useTranslations('settings.plugins');
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-muted/40 px-3 py-1.5">
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline">
          {installation.scope === undefined ? t('scope.unknown') : t(`scope.${installation.scope}`)}
        </Badge>
        {installation.version === undefined ? null : (
          <span className="text-label-tertiary text-2xs tabular-nums">v{installation.version}</span>
        )}
      </div>
      {installation.canToggle ? (
        <Switch
          checked={installation.enabled}
          disabled={busy}
          onCheckedChange={(checked) => onToggle(checked)}
        />
      ) : (
        <span className="text-2xs text-label-tertiary">
          {installation.enabled ? t('enabledReadOnly') : t('disabledReadOnly')}
        </span>
      )}
    </div>
  );
}

const COMPONENT_KIND_ORDER = [
  'skill',
  'command',
  'agent',
  'hook',
  'mcp-server',
  'lsp-server',
  'output-style',
  'channel',
  'app',
  'app-template',
] as const;

function ComponentSummary({
  counts,
}: {
  counts: PluginCardView['componentCounts'];
}): React.ReactNode {
  const t = useTranslations('settings.plugins');
  const parts: string[] = [];
  for (const kind of COMPONENT_KIND_ORDER) {
    const count = counts[kind];
    if (count !== undefined && count > 0) {
      parts.push(t('componentCount', { count, kind: t(`componentKind.${kind}`) }));
    }
  }
  if (parts.length === 0) return null;
  return <span>{parts.join(' · ')}</span>;
}
