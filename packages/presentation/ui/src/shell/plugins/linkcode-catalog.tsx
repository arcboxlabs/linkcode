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
import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxact/create-fixed-array';
import { DownloadIcon, RefreshCwIcon, Settings2Icon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { SettingsSection } from '../settings-page';
import type { LinkCodeCatalogCardView, LinkCodeInstalledPluginRow } from './types';

const SKELETON_ROWS = createFixedArray(2);

export interface LinkCodeInstalledSectionProps {
  /** Undefined while the first masked read is loading (skeletons). */
  rows: LinkCodeInstalledPluginRow[] | undefined;
  busy: boolean;
  onConfigure: (row: LinkCodeInstalledPluginRow) => void;
  onUninstall: (row: LinkCodeInstalledPluginRow) => void;
}

/** The installed LinkCode plugins; per-plugin settings and uninstall live here. */
export function LinkCodeInstalledSection({
  rows,
  busy,
  onConfigure,
  onUninstall,
}: LinkCodeInstalledSectionProps): React.ReactNode {
  const t = useTranslations('settings.plugins.linkcode');
  return (
    <SettingsSection title={t('installedTitle')}>
      {rows === undefined ? (
        <div className="flex flex-col gap-3">
          {SKELETON_ROWS.map((index) => (
            <Skeleton key={index} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="px-4 py-4">
          <p className="text-muted-foreground text-sm">{t('installedEmpty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <InstalledRow
              key={row.key}
              row={row}
              busy={busy}
              onConfigure={onConfigure}
              onUninstall={onUninstall}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function InstalledRow({
  row,
  busy,
  onConfigure,
  onUninstall,
}: {
  row: LinkCodeInstalledPluginRow;
  busy: boolean;
  onConfigure: (row: LinkCodeInstalledPluginRow) => void;
  onUninstall: (row: LinkCodeInstalledPluginRow) => void;
}): React.ReactNode {
  const t = useTranslations('settings.plugins');
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  return (
    <Card className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium text-sm">{row.title}</span>
        <span className="text-2xs text-label-tertiary tabular-nums">v{row.version}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {row.hasSettings ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('linkcode.configure')}
            disabled={busy}
            onClick={() => onConfigure(row)}
          >
            <Settings2Icon className="size-4" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('uninstall')}
          disabled={busy}
          onClick={() => setConfirmingUninstall(true)}
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>
      <AlertDialog open={confirmingUninstall} onOpenChange={setConfirmingUninstall}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('uninstallTitle', { title: row.title })}</AlertDialogTitle>
            <AlertDialogDescription>{t('uninstallHint')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline">{t('cancel')}</Button>} />
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmingUninstall(false);
                onUninstall(row);
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

export interface LinkCodeCatalogSectionProps {
  /** Marketplace display name; also the section title. */
  title: string;
  /** Undefined while the first refresh is in flight (skeletons). */
  cards: LinkCodeCatalogCardView[] | undefined;
  busy: boolean;
  /** True while a manual refresh is revalidating. */
  refreshing: boolean;
  onRefresh: () => void;
  onInstall: (card: LinkCodeCatalogCardView) => void;
}

/** One marketplace's catalog: name/version/description per release plus the install action. */
export function LinkCodeCatalogSection({
  title,
  cards,
  busy,
  refreshing,
  onRefresh,
  onInstall,
}: LinkCodeCatalogSectionProps): React.ReactNode {
  const t = useTranslations('settings.plugins');
  return (
    <SettingsSection
      title={
        <span className="flex w-full items-center justify-between">
          {title}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('linkcode.refresh')}
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCwIcon className={cn('size-3.5', refreshing && 'animate-spin')} />
          </Button>
        </span>
      }
    >
      {cards === undefined ? (
        <div className="flex flex-col gap-3">
          {SKELETON_ROWS.map((index) => (
            <Skeleton key={index} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <Card className="px-4 py-4">
          <p className="text-muted-foreground text-sm">{t('linkcode.catalogEmpty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((card) => (
            <CatalogCard key={card.key} card={card} busy={busy} onInstall={onInstall} />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function CatalogCard({
  card,
  busy,
  onInstall,
}: {
  card: LinkCodeCatalogCardView;
  busy: boolean;
  onInstall: (card: LinkCodeCatalogCardView) => void;
}): React.ReactNode {
  const t = useTranslations('settings.plugins');
  return (
    <Card className="flex items-start justify-between gap-4 p-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-sm">{card.title}</span>
          <span className="text-2xs text-label-tertiary tabular-nums">v{card.version}</span>
          {card.installed ? <Badge variant="secondary">{t('linkcode.installed')}</Badge> : null}
        </div>
        {card.description === undefined ? null : (
          <p className="line-clamp-2 text-muted-foreground text-xs">{card.description}</p>
        )}
        <span className="text-2xs text-label-tertiary">{card.pluginId}</span>
      </div>
      {card.installed ? null : (
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
      )}
    </Card>
  );
}
