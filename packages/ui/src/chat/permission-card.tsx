import type { PermissionOption, ToolCallUpdate } from '@linkcode/schema';
import { AlertAction } from 'coss-ui/components/alert';
import { useTranslations } from 'use-intl';
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationDescription,
  ConfirmationTitle,
} from './confirmation';

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'destructive-outline';

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
  className,
  toolCall,
  options,
  responding,
  pager,
  onRespond,
}: {
  className?: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
  responding: boolean;
  /** Rendered in the card's top-right action slot (e.g. a multi-request pager). */
  pager?: React.ReactNode;
  onRespond: (option: PermissionOption) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.permission');

  return (
    <Confirmation className={className}>
      <ConfirmationTitle title={t('title')} subject={toolCall.title ?? toolCall.toolCallId} />
      {pager ? <AlertAction>{pager}</AlertAction> : null}
      {responding ? (
        <ConfirmationDescription>{t('responding')}</ConfirmationDescription>
      ) : (
        <ConfirmationActions>
          {options.map((o) => (
            <ConfirmationAction
              key={o.optionId}
              size="sm"
              variant={variantFor(o.kind)}
              onClick={() => onRespond(o)}
            >
              {o.name}
            </ConfirmationAction>
          ))}
        </ConfirmationActions>
      )}
    </Confirmation>
  );
}
