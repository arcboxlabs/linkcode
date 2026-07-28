import { Button } from 'coss-ui/components/button';
import { TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import type { DirectivePlacementIssue, DirectiveStatus } from './directive-state';
import type { EditorDirective } from './serialize';

export type ComposerDirectiveIssue =
  | DirectivePlacementIssue
  | Exclude<DirectiveStatus, 'supported'>
  | 'attachments';

/** Compact persistent explanation for a blocked directive draft and its recovery actions. */
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

  function issueReason(): string {
    switch (issue) {
      case 'attachments':
        return t('directiveAttachmentsConflict');
      case 'multiple':
        return t('multipleDirectives', { directive: label });
      case 'misplaced':
        return directive.kind === 'command' ? t('commandMisplaced') : t('shellMisplaced');
      case 'unknown':
        return directive.kind === 'command'
          ? t('commandUnknown', { command: directive.name })
          : t('shellUnsupported');
      case 'unsupported':
        return directive.kind === 'command' ? t('commandUnsupported') : t('shellUnsupported');
      default:
        return issue satisfies never;
    }
  }

  const reason = issueReason();
  return (
    <div
      className="flex w-full flex-wrap items-center gap-x-1 gap-y-1 px-2 pt-2 pb-1"
      data-slot="composer-directive-hint"
      role="status"
    >
      <div className="flex min-h-7 min-w-64 flex-1 items-center gap-2 px-2 text-warning-foreground text-sm">
        <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 break-words">{reason}</span>
      </div>
      <div className="ms-auto flex items-center gap-1">
        {onMoveToStart ? (
          <Button disabled={disabled} size="sm" variant="ghost" onClick={onMoveToStart}>
            {t('moveDirectiveToStart')}
          </Button>
        ) : null}
        <Button disabled={disabled} size="sm" variant="ghost" onClick={onConvertToText}>
          {t('convertToText')}
        </Button>
        <Button disabled={disabled} size="sm" variant="ghost" onClick={onRemove}>
          {t('removeDirective')}
        </Button>
      </div>
    </div>
  );
}
