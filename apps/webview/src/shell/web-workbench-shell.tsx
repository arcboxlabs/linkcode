import { ErrorBadge, ShellFrame, ShellIconButton, TitleStrip } from '@linkcode/ui';
import type { WorkbenchShellProps } from '@linkcode/workbench';
import { useResourcesPanelStore, WorkspaceServicesMenu } from '@linkcode/workbench';
import { Button } from 'coss-ui/components/button';
import { Drawer, DrawerPopup } from 'coss-ui/components/drawer';
import { useMediaQuery } from 'coss-ui/hooks/use-media-query';
import { ChevronLeftIcon, ChevronRightIcon, PackageOpenIcon, SettingsIcon } from 'lucide-react';
import { ViewTransition } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslations } from 'use-intl';

export function WebWorkbenchShell({
  header,
  navigation,
  resourcesPanel,
  ...props
}: WorkbenchShellProps): React.ReactNode {
  const t = useTranslations('workbench.palette');
  const tPanel = useTranslations('workbench.panel.window');
  const navigate = useNavigate();
  const resourcesOpen = useResourcesPanelStore((state) => state.open);
  const setResourcesOpen = useResourcesPanelStore((state) => state.setOpen);
  const wide = useMediaQuery('lg');
  const resourcesAvailable = props.activeSession !== null && resourcesPanel !== undefined;
  const hasUsage =
    header.usage != null && (header.usage.inputTokens != null || header.usage.outputTokens != null);

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1">
        <ShellFrame
          {...props}
          onOpenAutomations={() => {
            void navigate('/automations');
          }}
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
                {/* data-conversation-title is the browser-smoke E2E's header selector. */}
                {header.sessionId ? (
                  <ViewTransition
                    key={header.sessionId}
                    enter="none"
                    exit="none"
                    name={`thread-title-${header.sessionId}`}
                  >
                    <div className="truncate font-medium text-sm" data-conversation-title="">
                      {header.title}
                    </div>
                  </ViewTransition>
                ) : (
                  <div className="truncate font-medium text-sm" data-conversation-title="">
                    {header.title}
                  </div>
                )}
                {header.subtitle && (
                  <div className="truncate text-muted-foreground text-xs">{header.subtitle}</div>
                )}
              </div>
              {/* The draft page reports errors through its own banner. */}
              <ErrorBadge
                errorMessage={props.draft ? null : props.errorMessage}
                onDismissError={props.onDismissError}
              />
              <div className="ml-auto flex items-center gap-2">
                {/* No in-app browser in the web client: preview links always open a new tab. */}
                <WorkspaceServicesMenu cwd={props.activeSession?.cwd} />
                {hasUsage && (
                  <span className="font-mono text-muted-foreground text-xs">
                    {header.usage?.inputTokens ?? 0} in / {header.usage?.outputTokens ?? 0} out
                  </span>
                )}
                {resourcesAvailable && (
                  <ShellIconButton
                    label={tPanel('resources')}
                    aria-pressed={resourcesOpen}
                    onClick={() => setResourcesOpen(!resourcesOpen)}
                  >
                    <PackageOpenIcon />
                  </ShellIconButton>
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
      </div>
      {wide && resourcesAvailable && resourcesOpen && (
        <aside
          aria-label={tPanel('resources')}
          className="w-96 shrink-0 border-border border-l bg-background"
        >
          {resourcesPanel}
        </aside>
      )}
      {!wide && resourcesAvailable && (
        <Drawer open={resourcesOpen} onOpenChange={setResourcesOpen} position="right">
          <DrawerPopup className="w-[min(24rem,calc(100%-3rem))]" position="right">
            <div className="h-full min-h-0 pt-3">{resourcesPanel}</div>
          </DrawerPopup>
        </Drawer>
      )}
    </div>
  );
}
