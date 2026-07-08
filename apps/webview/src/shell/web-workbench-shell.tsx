import { ShellFrame, ShellIconButton, TitleStrip } from '@linkcode/ui';
import type { WorkbenchShellProps } from '@linkcode/workbench';
import { WorkspaceServicesMenu } from '@linkcode/workbench';
import { Button } from 'coss-ui/components/button';
import { ChevronLeftIcon, ChevronRightIcon, SettingsIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslations } from 'use-intl';

export function WebWorkbenchShell({
  header,
  navigation,
  ...props
}: WorkbenchShellProps): React.ReactNode {
  const t = useTranslations('workbench.palette');
  const hasUsage =
    header.usage != null && (header.usage.inputTokens != null || header.usage.outputTokens != null);

  return (
    <ShellFrame
      {...props}
      header={
        <TitleStrip className="border-border border-b">
          <ShellIconButton
            label={t('goBack')}
            disabled={!navigation.canGoBack}
            onClick={navigation.onBack}
          >
            <ChevronLeftIcon className="size-4" />
          </ShellIconButton>
          <ShellIconButton
            label={t('goForward')}
            disabled={!navigation.canGoForward}
            onClick={navigation.onForward}
          >
            <ChevronRightIcon className="size-4" />
          </ShellIconButton>
          <div className="min-w-0">
            <div className="truncate font-medium text-sm">{header.title}</div>
            {header.subtitle && (
              <div className="truncate text-muted-foreground text-xs">{header.subtitle}</div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* No in-app browser in the web client: preview links always open a new tab. */}
            <WorkspaceServicesMenu cwd={props.activeSession?.cwd} />
            {hasUsage && (
              <span className="font-mono text-muted-foreground text-xs">
                {header.usage?.inputTokens ?? 0} in / {header.usage?.outputTokens ?? 0} out
              </span>
            )}
            <Button
              render={<Link to="/settings" />}
              size="icon-sm"
              variant="ghost"
              aria-label={t('openSettings')}
            >
              <SettingsIcon />
            </Button>
          </div>
        </TitleStrip>
      }
    />
  );
}
