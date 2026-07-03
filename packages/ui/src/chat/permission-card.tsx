import type { PermissionOption, PermissionOutcome, ToolCallUpdate } from '@linkcode/schema';
import { useTranslations } from 'use-intl';
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationDescription,
  ConfirmationTitle,
} from './confirmation';

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'destructive-outline';

/** The display name of the option a `selected` resolution picked, if it is still known. */
function pickedOptionName(
  options: PermissionOption[],
  resolution: PermissionOutcome | undefined,
): string | undefined {
  if (resolution?.outcome !== 'selected') return undefined;
  for (const option of options) {
    if (option.optionId === resolution.optionId) return option.name;
  }
  return undefined;
}

function variantFor(kind: PermissionOption['kind']): ButtonVariant {
  switch (kind) {
    case 'allow_once':
      return 'secondary';
    case 'allow_always':
      return 'default';
    case 'reject_once':
      return 'outline';
    case 'reject_always':
      return 'destructive-outline';
    default:
      return 'outline';
  }
}

export function PermissionCard({
  toolCall,
  options,
  resolution,
  answered,
  responding,
  onRespond,
}: {
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
  resolution?: PermissionOutcome;
  answered: boolean;
  responding: boolean;
  onRespond: (optionId: string) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.permission');

  if (answered) {
    // Settled asks collapse to a slim, muted one-liner: the ask title plus how it settled — the
    // picked option's name when known, `cancelled`/`answered` otherwise.
    const picked = pickedOptionName(options, resolution);
    const label = picked ?? (resolution?.outcome === 'cancelled' ? t('cancelled') : t('answered'));
    return (
      <Confirmation className="flex items-center justify-between gap-2 border-border bg-muted/30 p-2">
        <ConfirmationTitle
          className="mb-0 min-w-0"
          title={t('title')}
          subject={toolCall.title ?? toolCall.toolCallId}
        />
        <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      </Confirmation>
    );
  }

  return (
    <Confirmation>
      <ConfirmationTitle title={t('title')} subject={toolCall.title ?? toolCall.toolCallId} />
      {responding ? (
        <ConfirmationDescription>{t('responding')}</ConfirmationDescription>
      ) : (
        <ConfirmationActions>
          {options.map((o) => (
            <ConfirmationAction
              key={o.optionId}
              size="sm"
              variant={variantFor(o.kind)}
              onClick={() => onRespond(o.optionId)}
            >
              {o.name}
            </ConfirmationAction>
          ))}
        </ConfirmationActions>
      )}
    </Confirmation>
  );
}
