import type { PermissionOption, ToolCallUpdate } from '@linkcode/schema';
import type { ReactNode } from 'react';
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
  toolCall,
  options,
  answered,
  responding,
  onRespond,
}: {
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
  answered: boolean;
  responding: boolean;
  onRespond: (optionId: string) => void;
}): ReactNode {
  const t = useTranslations('workbench.permission');

  return (
    <Confirmation>
      <ConfirmationTitle title={t('title')} subject={toolCall.title ?? toolCall.toolCallId} />
      {answered ? (
        <ConfirmationDescription>{t('answered')}</ConfirmationDescription>
      ) : responding ? (
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
