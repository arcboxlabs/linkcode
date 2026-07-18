import { Alert, AlertAction, AlertDescription } from 'coss-ui/components/alert';
import { Button } from 'coss-ui/components/button';
import { TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import type { DirectivePlacementIssue, DirectiveStatus } from './directive-state';
import type { EditorDirective } from './serialize';

export type ComposerDirectiveIssue =
  | DirectivePlacementIssue
  | Exclude<DirectiveStatus, 'supported'>;

/**
 * Always-visible explanation for a blocked directive draft — the chip's tint alone is too
 * subtle, and its tooltip only surfaces on hover. Renders the reason plus the same recovery
 * actions the chip menu offers, so the user never has to discover them by hovering.
 */
export function ComposerDirectiveHint({
  directive,
  disabled,
  issue,
  onConvertToText,
  onMoveToStart,
  onRemove,
}: {
  directive: EditorDirective;
  disabled: boolean;
  issue: ComposerDirectiveIssue;
  onConvertToText: () => void;
  onMoveToStart?: () => void;
  onRemove: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.composer');
  const label = directive.kind === 'command' ? `/${directive.name}` : '$';
  const reason =
    issue === 'multiple'
      ? t('multipleDirectives', { directive: label })
      : issue === 'misplaced'
        ? directive.kind === 'command'
          ? t('commandMisplaced')
          : t('shellMisplaced')
        : directive.kind === 'shell'
          ? t('shellUnsupported')
          : issue === 'unknown'
            ? t('commandUnknown', { command: directive.name })
            : t('commandUnsupported');
  const variant =
    issue === 'unknown' || (directive.kind === 'shell' && issue === 'unsupported')
      ? 'error'
      : 'warning';
  return (
    <Alert
      className="mx-1 mb-1.5 w-auto rounded-md px-1 py-1.5 text-xs has-[>svg]:has-data-[slot=alert-action]:grid-cols-[calc(var(--spacing)*4)_1fr] sm:mx-3.5 sm:px-2"
      data-slot="composer-directive-hint"
      variant={variant}
    >
      <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
      <AlertDescription className="min-w-0 break-words text-xs">{reason}</AlertDescription>
      <AlertAction className="mt-1.5 flex-wrap justify-end gap-y-1 ![grid-column:1/-1] ![grid-row:2] max-sm:flex-col">
        {onMoveToStart ? (
          <Button
            className="h-6 px-2 text-xs max-sm:w-full"
            disabled={disabled}
            size="sm"
            variant="ghost"
            onClick={onMoveToStart}
          >
            {t('moveDirectiveToStart')}
          </Button>
        ) : null}
        <Button
          className="h-6 px-2 text-xs max-sm:w-full"
          disabled={disabled}
          size="sm"
          variant="ghost"
          onClick={onConvertToText}
        >
          {t('convertToText')}
        </Button>
        <Button
          className="h-6 px-2 text-xs max-sm:w-full"
          disabled={disabled}
          size="sm"
          variant="ghost"
          onClick={onRemove}
        >
          {t('removeDirective')}
        </Button>
      </AlertAction>
    </Alert>
  );
}
