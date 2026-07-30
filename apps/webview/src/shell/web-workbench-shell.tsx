import { ErrorBadge, ShellFrame, ShellIconButton, TitleStrip } from '@linkcode/ui';
import type { WorkbenchShellProps } from '@linkcode/workbench';
import {
  getResourcesPanelPresentation,
  useResourcesPanelStore,
  WorkspaceServicesMenu,
} from '@linkcode/workbench';
import { Button } from 'coss-ui/components/button';
import { Card } from 'coss-ui/components/card';
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from 'coss-ui/components/dialog';
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
  const wide = useMediaQuery('xl');
  const resourcesAvailable = props.activeSession !== null && resourcesPanel !== undefined;
  const resourcesPresentation = getResourcesPanelPresentation({
    available: resourcesAvailable,
    wide,
  });
  const hasUsage =
    header.usage != null && (header.usage.inputTokens != null || header.usage.outputTokens != null);

  return (
    <div className="relative h-full min-h-0">
      <div className="h-full min-w-0">
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
      {resourcesPresentation === 'floating' && resourcesOpen && (
        <Card
          aria-label={tPanel('resources')}
          className="absolute top-12 right-3 z-20 max-h-[calc(100%-3.75rem)] w-72 overflow-hidden shadow-xl"
        >
          {resourcesPanel}
        </Card>
      )}
      {resourcesPresentation === 'dialog' && (
        <Dialog open={resourcesOpen} onOpenChange={setResourcesOpen}>
          <DialogPopup bottomStickOnMobile={false} className="max-h-[calc(100dvh-2rem)] max-w-md">
            <DialogHeader className="border-border border-b p-4">
              <DialogTitle className="text-base">{tPanel('resources')}</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">{resourcesPanel}</div>
          </DialogPopup>
        </Dialog>
      )}
    </div>
  );
}
