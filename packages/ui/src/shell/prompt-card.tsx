import { Alert, AlertAction, AlertDescription } from 'coss-ui/components/alert';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from 'coss-ui/components/frame';
import { Spinner } from 'coss-ui/components/spinner';
import { useId } from 'react';
import { cn } from '../lib/cn';

const EMPTY_DETAILS: readonly PromptCardDetail[] = [];

export interface PromptCardDetail {
  label: string;
  value: string;
  monospace?: boolean;
  multiline?: boolean;
}

export interface PromptCardError {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}

export function PromptCard({
  badge,
  busyLabel,
  children,
  description,
  details = EMPTY_DETAILS,
  disabled = false,
  eyebrow,
  error,
  footer,
  meta,
  panelClassName,
  title,
  tone = 'neutral',
}: {
  badge?: string;
  busyLabel?: string;
  children?: React.ReactNode;
  description?: string;
  details?: readonly PromptCardDetail[];
  disabled?: boolean;
  eyebrow?: React.ReactNode;
  error?: PromptCardError;
  footer?: React.ReactNode;
  meta?: React.ReactNode;
  panelClassName?: string;
  title: string;
  tone?: 'neutral' | 'warning';
}): React.ReactNode {
  const titleId = useId();
  const hasPanel = children !== undefined || details.length > 0 || error !== undefined;

  return (
    <Frame
      aria-busy={disabled || undefined}
      aria-labelledby={titleId}
      className="my-0"
      role="group"
    >
      <FrameHeader className="gap-1.5 px-3 py-2.5">
        {eyebrow}
        <div className="flex min-w-0 items-start justify-between gap-3">
          <FrameTitle className="flex min-w-0 items-center gap-2">
            <span id={titleId} className="min-w-0">
              {title}
            </span>
            {badge ? (
              <Badge variant={tone === 'warning' ? 'warning' : 'secondary'}>{badge}</Badge>
            ) : null}
          </FrameTitle>
          {(disabled && busyLabel) || meta ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {disabled && busyLabel ? (
                <Spinner aria-label={busyLabel} className="size-3.5" />
              ) : null}
              {meta}
            </div>
          ) : null}
        </div>
        {description ? (
          <FrameDescription className="max-w-2xl text-pretty">{description}</FrameDescription>
        ) : null}
      </FrameHeader>
      {hasPanel ? (
        <FramePanel className={cn('space-y-3 p-2', panelClassName)}>
          {details.length > 0 ? <PromptCardDetails details={details} /> : null}
          {children}
          {error ? (
            <Alert variant="error">
              <AlertDescription>{error.message}</AlertDescription>
              <AlertAction>
                <Button
                  disabled={disabled}
                  size="xs"
                  variant="destructive-outline"
                  onClick={error.onRetry}
                >
                  {error.retryLabel}
                </Button>
              </AlertAction>
            </Alert>
          ) : null}
        </FramePanel>
      ) : null}
      {footer !== undefined ? (
        <FrameFooter className="flex items-center justify-between gap-2 px-2 py-1.5">
          {footer}
        </FrameFooter>
      ) : null}
    </Frame>
  );
}

function PromptCardDetails({ details }: { details: readonly PromptCardDetail[] }): React.ReactNode {
  return (
    <div className="space-y-0.5">
      {details.map((detail) => (
        <div key={`${detail.label}:${detail.value}`} className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs">{detail.label}</span>
          <span
            className={cn(
              'min-w-0 text-foreground text-xs',
              detail.multiline
                ? 'max-h-24 overflow-auto whitespace-pre-wrap break-all'
                : 'truncate',
              detail.monospace && 'font-mono',
            )}
          >
            {detail.value}
          </span>
        </div>
      ))}
    </div>
  );
}
