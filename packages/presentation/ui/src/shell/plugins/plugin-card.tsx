import type { PluginScope } from '@linkcode/schema';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from 'coss-ui/components/alert-dialog';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Card } from 'coss-ui/components/card';
import { Switch } from 'coss-ui/components/switch';
import { DownloadIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
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
  onInstall: (card: PluginCardView) => void;
  onUninstall: (card: PluginCardView) => void;
}

/** One provider plugin: identity, capability summary, and per-installation enablement. */
export function PluginCard({
  card,
  busy,
  showInstallState = true,
  onToggleInstallation,
  onInstall,
  onUninstall,
}: PluginCardProps): React.ReactNode {
  const t = useTranslations('settings.plugins');
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
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
        {card.installed ? (
          card.canUninstall ? (
            <Button
              aria-label={t('uninstall')}
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              disabled={busy}
              onClick={() => setConfirmingUninstall(true)}
            >
              <Trash2Icon className="size-4" />
            </Button>
          ) : null
        ) : card.canInstall ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={() => onInstall(card)}
          >
            <DownloadIcon className="size-4" />
            {t('install')}
          </Button>
        ) : null}
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
      <AlertDialog open={confirmingUninstall} onOpenChange={setConfirmingUninstall}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('uninstallTitle', { title: card.title })}</AlertDialogTitle>
            <AlertDialogDescription>{t('uninstallHint')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline">{t('cancel')}</Button>} />
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmingUninstall(false);
                onUninstall(card);
              }}
            >
              {t('uninstall')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
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
      parts.push(t(`componentCount.${kind}`, { count }));
    }
  }
  if (parts.length === 0) return null;
  return <span>{parts.join(' · ')}</span>;
}
