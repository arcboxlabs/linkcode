import type { AgentKind } from '@linkcode/schema';
import { Alert, AlertAction, AlertDescription, AlertTitle } from 'coss-ui/components/alert';
import { Button } from 'coss-ui/components/button';
import { Input } from 'coss-ui/components/input';
import { Progress, ProgressIndicator, ProgressTrack } from 'coss-ui/components/progress';
import { DownloadIcon, Loader2Icon, LogInIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
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
  | { state: 'unverified'; version?: string }
  /**
   * The CLI is installed but signed out. `phase` tracks the interactive login: `idle` (offer the
   * button) → `opening` (browser launching) → `awaiting-code` (paste the code from `url`) →
   * `failed`. Success removes the cue via the runtime re-probe rather than a phase.
   */
  | {
      state: 'needs-login';
      phase: 'idle' | 'opening' | 'awaiting-code' | 'failed';
      url?: string;
      error?: string;
    };

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
  onLogin,
  onSubmitLoginCode,
  onCancelLogin,
}: {
  kind: AgentKind;
  cue: AgentRuntimeCue;
  onDownload?: (kind: AgentKind) => void;
  onContinueUnverified?: (kind: AgentKind) => void;
  onLogin?: (kind: AgentKind) => void;
  onSubmitLoginCode?: (kind: AgentKind, code: string) => void;
  onCancelLogin?: (kind: AgentKind) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.agentRuntime');

  if (cue.state === 'needs-login') {
    return (
      <AgentLoginCard
        kind={kind}
        cue={cue}
        onLogin={onLogin}
        onSubmitLoginCode={onSubmitLoginCode}
        onCancelLogin={onCancelLogin}
      />
    );
  }

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

/** Kinds whose flow hands the user an authorization code to paste back (claude's remote callback
 * page); the rest (codex) complete on the CLI's own localhost callback — the awaiting phase just
 * waits for the browser. */
const PASTE_CODE_KINDS: ReadonlySet<AgentKind> = new Set(['claude-code']);

/**
 * The signed-out branch of {@link AgentOnboardingCard}: a self-contained login flow. `idle` offers
 * the button; `opening` shows a spinner while the browser launches; `awaiting-code` takes the
 * authorization code pasted from the browser (with a fallback link to reopen the URL) — or, for
 * kinds without a code hand-back, waits for the browser flow to settle; `failed` offers a retry.
 * Owns only the ephemeral code-input value — everything else arrives via props.
 */
function AgentLoginCard({
  kind,
  cue,
  onLogin,
  onSubmitLoginCode,
  onCancelLogin,
}: {
  kind: AgentKind;
  cue: Extract<AgentRuntimeCue, { state: 'needs-login' }>;
  onLogin?: (kind: AgentKind) => void;
  onSubmitLoginCode?: (kind: AgentKind, code: string) => void;
  onCancelLogin?: (kind: AgentKind) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.agentRuntime');
  const agent = AGENT_LABELS[kind];
  const [code, setCode] = useState('');

  if (cue.phase === 'opening') {
    return (
      <Alert>
        <Loader2Icon className="animate-spin" />
        <AlertTitle>{t('loginOpening', { agent })}</AlertTitle>
      </Alert>
    );
  }

  if (cue.phase === 'awaiting-code' && !PASTE_CODE_KINDS.has(kind)) {
    return (
      <Alert>
        <Loader2Icon className="animate-spin" />
        <AlertTitle>{t('needsLoginTitle', { agent })}</AlertTitle>
        <AlertDescription className="w-full">
          {t('loginAwaitingBrowser')}
          {cue.url && (
            <a
              className="mt-1 block underline underline-offset-2"
              href={cue.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t('loginReopenUrl')}
            </a>
          )}
          {onCancelLogin && (
            <div className="mt-2">
              <Button size="sm" variant="ghost" onClick={() => onCancelLogin(kind)}>
                {t('loginCancel')}
              </Button>
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  if (cue.phase === 'awaiting-code') {
    const submit = (): void => {
      const trimmed = code.trim();
      if (trimmed && onSubmitLoginCode) onSubmitLoginCode(kind, trimmed);
    };
    return (
      <Alert>
        <LogInIcon />
        <AlertTitle>{t('needsLoginTitle', { agent })}</AlertTitle>
        <AlertDescription className="w-full">
          {t('loginAwaitingCode')}
          {cue.url && (
            <a
              className="mt-1 block underline underline-offset-2"
              href={cue.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t('loginReopenUrl')}
            </a>
          )}
          <div className="mt-2 flex gap-2">
            <Input
              autoFocus
              placeholder={t('loginCodePlaceholder')}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) submit();
              }}
            />
            <Button disabled={code.trim().length === 0} size="sm" onClick={submit}>
              {t('loginSubmit')}
            </Button>
            {onCancelLogin && (
              <Button size="sm" variant="ghost" onClick={() => onCancelLogin(kind)}>
                {t('loginCancel')}
              </Button>
            )}
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (cue.phase === 'failed') {
    return (
      <Alert variant="error">
        <TriangleAlertIcon />
        <AlertTitle>{t('loginFailedTitle', { agent })}</AlertTitle>
        {cue.error && <AlertDescription>{cue.error}</AlertDescription>}
        {onLogin && (
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => onLogin(kind)}>
              {t('retry')}
            </Button>
          </AlertAction>
        )}
      </Alert>
    );
  }

  return (
    <Alert>
      <LogInIcon />
      <AlertTitle>{t('needsLoginTitle', { agent })}</AlertTitle>
      <AlertDescription>{t('needsLoginBody', { agent })}</AlertDescription>
      {onLogin && (
        <AlertAction>
          <Button size="sm" onClick={() => onLogin(kind)}>
            {t('login', { agent })}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
