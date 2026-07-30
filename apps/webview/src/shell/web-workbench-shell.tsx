import { ErrorBadge, ShellFrame, ShellIconButton, TitleStrip } from '@linkcode/ui';
import type { WorkbenchShellProps } from '@linkcode/workbench';
import {
  getResourcesPanelPresentation,
  RESOURCES_FLOATING_COLUMN_WIDTH,
  RESOURCES_FLOATING_MIN_WORKSPACE_WIDTH,
  useResourcesPanelStore,
  WorkspaceServicesMenu,
} from '@linkcode/workbench';
import { Button } from 'coss-ui/components/button';
import { Card } from 'coss-ui/components/card';
import { Popover, PopoverPopup, PopoverTrigger } from 'coss-ui/components/popover';
import { useMediaQuery } from 'coss-ui/hooks/use-media-query';
import { ChevronLeftIcon, ChevronRightIcon, PackageOpenIcon, SettingsIcon } from 'lucide-react';
import { ViewTransition } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslations } from 'use-intl';

const WEB_SIDEBAR_WIDTH = 288;

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
  const floatingSpaceAvailable = useMediaQuery({
    min: WEB_SIDEBAR_WIDTH + RESOURCES_FLOATING_MIN_WORKSPACE_WIDTH,
  });
  const resourcesAvailable = props.activeSession !== null && resourcesPanel !== undefined;
  const resourcesPresentation = getResourcesPanelPresentation({
    available: resourcesAvailable,
    floatingSpaceAvailable,
  });
  const resourcesFloatingOpen = resourcesPresentation === 'floating' && resourcesOpen;
  const resourcesButton = (
    <ShellIconButton
      label={tPanel('resources')}
      aria-pressed={resourcesOpen}
      onClick={
        resourcesPresentation === 'popover' ? undefined : () => setResourcesOpen(!resourcesOpen)
      }
    >
      <PackageOpenIcon />
    </ShellIconButton>
  );
  const hasUsage =
    header.usage != null && (header.usage.inputTokens != null || header.usage.outputTokens != null);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_auto] overflow-hidden">
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
                {resourcesAvailable &&
                  (resourcesPresentation === 'popover' ? (
                    <Popover open={resourcesOpen} onOpenChange={setResourcesOpen}>
                      <PopoverTrigger render={resourcesButton} />
                      <PopoverPopup
                        align="end"
                        side="bottom"
                        sideOffset={8}
                        className="w-72 [&_[data-slot=popover-viewport]]:p-0"
                      >
                        <div className="max-h-[min(32rem,var(--available-height))] min-h-0 overflow-y-auto">
                          {resourcesPanel}
                        </div>
                      </PopoverPopup>
                    </Popover>
                  ) : (
                    resourcesButton
                  ))}
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
      <aside
        aria-hidden={!resourcesFloatingOpen}
        inert={!resourcesFloatingOpen}
        className="min-h-0 min-w-0 shrink-0 overflow-hidden transition-[width] duration-(--motion-normal) ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
        style={{ width: resourcesFloatingOpen ? RESOURCES_FLOATING_COLUMN_WIDTH : 0 }}
      >
        <div className="h-full p-3 pt-12" style={{ width: RESOURCES_FLOATING_COLUMN_WIDTH }}>
          <Card aria-label={tPanel('resources')} className="w-72 overflow-hidden shadow-xl">
            <div className="max-h-[min(32rem,calc(100vh-3.75rem))] min-h-0 overflow-y-auto">
              {resourcesPresentation === 'floating' ? resourcesPanel : null}
            </div>
          </Card>
        </div>
      </aside>
    </div>
  );
}
