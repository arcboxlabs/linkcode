import type { AgentKind } from '@linkcode/schema';
import { Alert, AlertAction, AlertDescription, AlertTitle } from 'coss-ui/components/alert';
import { Button } from 'coss-ui/components/button';
import { Progress, ProgressIndicator, ProgressTrack } from 'coss-ui/components/progress';
import { DownloadIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { AGENT_LABELS } from '../chat/agent-icon';

/**
 * Per-agent runtime cue the workbench derives for the onboarding flow (CODE-112). Absence of a
 * cue means the runtime is ready (or unevaluated, e.g. opencode until CODE-76) — nothing renders
 * and sending is not blocked. Any present cue blocks sending for that agent.
 */
export type AgentRuntimeCue =
  | { state: 'missing'; downloadable: boolean }
  | { state: 'downloading'; receivedBytes: number; totalBytes?: number }
  | { state: 'failed'; error: string }
  | { state: 'unverified'; version?: string };

export type AgentRuntimeCues = Partial<Record<AgentKind, AgentRuntimeCue>>;

function formatMegabytes(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1);
}

/**
 * Inline guidance for an agent whose CLI runtime is not ready: offers the managed download
 * (with live progress and retry) or, for unverified detected versions, the choice to continue.
 * Pure presentation — every decision and side effect arrives via props.
 */
export function AgentOnboardingCard({
  kind,
  cue,
  onDownload,
  onContinueUnverified,
}: {
  kind: AgentKind;
  cue: AgentRuntimeCue;
  onDownload?: (kind: AgentKind) => void;
  onContinueUnverified?: (kind: AgentKind) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.agentRuntime');
  const agent = AGENT_LABELS[kind];

  switch (cue.state) {
    case 'missing':
      return (
        <Alert>
          <DownloadIcon />
          <AlertTitle>{t('missingTitle', { agent })}</AlertTitle>
          <AlertDescription>
            {cue.downloadable ? t('missingBody', { agent }) : t('missingNoDownload', { agent })}
          </AlertDescription>
          {cue.downloadable && onDownload && (
            <AlertAction>
              <Button size="sm" onClick={() => onDownload(kind)}>
                {t('download')}
              </Button>
            </AlertAction>
          )}
        </Alert>
      );
    case 'downloading': {
      const { receivedBytes, totalBytes } = cue;
      return (
        <Alert>
          <DownloadIcon />
          <AlertTitle>{t('downloadingTitle', { agent })}</AlertTitle>
          <AlertDescription className="w-full">
            <Progress
              className="mt-1.5"
              max={totalBytes ?? undefined}
              value={totalBytes === undefined ? null : receivedBytes}
            >
              <ProgressTrack>
                <ProgressIndicator />
              </ProgressTrack>
            </Progress>
            <span className="mt-1 block tabular-nums">
              {totalBytes === undefined
                ? t('downloadedSoFar', { received: formatMegabytes(receivedBytes) })
                : t('downloadedOf', {
                    received: formatMegabytes(receivedBytes),
                    total: formatMegabytes(totalBytes),
                  })}
            </span>
          </AlertDescription>
        </Alert>
      );
    }
    case 'failed':
      return (
        <Alert variant="error">
          <TriangleAlertIcon />
          <AlertTitle>{t('failedTitle', { agent })}</AlertTitle>
          <AlertDescription>{cue.error}</AlertDescription>
          {onDownload && (
            <AlertAction>
              <Button size="sm" variant="outline" onClick={() => onDownload(kind)}>
                {t('retry')}
              </Button>
            </AlertAction>
          )}
        </Alert>
      );
    case 'unverified':
      return (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>{t('unverifiedTitle', { agent })}</AlertTitle>
          <AlertDescription>
            {t('unverifiedBody', { version: cue.version ?? t('unknownVersion') })}
          </AlertDescription>
          <AlertAction className="flex gap-2">
            {onDownload && (
              <Button size="sm" onClick={() => onDownload(kind)}>
                {t('downloadPaired')}
              </Button>
            )}
            {onContinueUnverified && (
              <Button size="sm" variant="ghost" onClick={() => onContinueUnverified(kind)}>
                {t('continueUnverified')}
              </Button>
            )}
          </AlertAction>
        </Alert>
      );
    // no default
  }
}
