import type { WorkspaceScript } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from 'coss-ui/components/menu';
import { GlobeIcon, PlayIcon, ScrollTextIcon, ServerIcon, SquareIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';

export interface ServicesMenuProps {
  scripts: WorkspaceScript[];
  onRun: (scriptName: string) => void;
  onStop: (scriptName: string) => void;
  /** Jump to the script's log terminal; absent hides the View action. */
  onViewLogs?: (terminalId: string) => void;
  /** Open a running service's preview URL (the host decides in-app vs external). */
  onOpenUrl: (url: string) => void;
}

/** Chrome chip + dropdown listing the workspace's declared scripts (paseo-style). */
export function ServicesMenu({
  scripts,
  onRun,
  onStop,
  onViewLogs,
  onOpenUrl,
}: ServicesMenuProps): React.ReactNode {
  const t = useTranslations('workbench.preview');
  if (scripts.length === 0) return null;
  const runningCount = scripts.filter((s) => s.lifecycle === 'running').length;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="pointer-events-auto shrink-0 gap-1.5 text-xs [-webkit-app-region:no-drag]"
          >
            <ServerIcon className="size-3.5" />
            {t('services')}
            {runningCount > 0 && <span className="text-success-foreground">{runningCount}</span>}
          </Button>
        }
      />
      <MenuPopup align="end" className="min-w-64">
        {scripts.map((script, index) => (
          <MenuGroup key={script.scriptName}>
            {index > 0 && <MenuSeparator />}
            <MenuGroupLabel className="flex items-center gap-2">
              <HealthDot script={script} />
              <span className="min-w-0 flex-1 truncate font-medium">{script.scriptName}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {script.command}
              </span>
            </MenuGroupLabel>
            {script.lifecycle === 'running' ? (
              <>
                {script.type === 'service' && script.localProxyUrl && (
                  <MenuItem className="gap-2" onClick={() => onOpenUrl(script.localProxyUrl!)}>
                    <GlobeIcon className="size-3.5 text-muted-foreground" />
                    <span className="min-w-0 truncate font-mono text-xs">{script.hostname}</span>
                  </MenuItem>
                )}
                {onViewLogs && script.terminalId && (
                  <MenuItem className="gap-2" onClick={() => onViewLogs(script.terminalId!)}>
                    <ScrollTextIcon className="size-3.5 text-muted-foreground" />
                    {t('viewLogs')}
                  </MenuItem>
                )}
                <MenuItem className="gap-2" onClick={() => onStop(script.scriptName)}>
                  <SquareIcon className="size-3.5 text-muted-foreground" />
                  {t('stop')}
                </MenuItem>
              </>
            ) : (
              <MenuItem className="gap-2" onClick={() => onRun(script.scriptName)}>
                <PlayIcon className="size-3.5 text-muted-foreground" />
                {t('run')}
                {script.lifecycle === 'stopped' &&
                  script.exitCode !== undefined &&
                  script.exitCode !== 0 && (
                    <span className="ml-auto text-[11px] text-destructive-foreground">
                      {t('exitCode', { code: script.exitCode ?? 'signal' })}
                    </span>
                  )}
              </MenuItem>
            )}
          </MenuGroup>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function HealthDot({ script }: { script: WorkspaceScript }): React.ReactNode {
  return (
    <span
      aria-hidden
      className={cn(
        'size-2 shrink-0 rounded-full',
        script.lifecycle === 'running'
          ? script.type === 'task'
            ? 'bg-sky-500'
            : script.health === 'healthy'
              ? 'bg-emerald-500'
              : 'bg-red-500'
          : script.lifecycle === 'stopped'
            ? 'bg-zinc-400'
            : 'bg-muted-foreground/40',
      )}
    />
  );
}
