import type { PermissionOption, ToolCallUpdate } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { ShieldIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';

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
    <div className="my-1 rounded-xl border border-warning/40 bg-warning/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-foreground">
        <ShieldIcon className="size-4 text-warning-foreground" />
        {t('title')}
        <span className="truncate font-normal text-muted-foreground">
          {toolCall.title ?? toolCall.toolCallId}
        </span>
      </div>
      {answered ? (
        <div className="text-[13px] text-muted-foreground">{t('answered')}</div>
      ) : responding ? (
        <div className="text-[13px] text-muted-foreground">{t('responding')}</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <Button
              key={o.optionId}
              size="sm"
              variant={variantFor(o.kind)}
              onClick={() => onRespond(o.optionId)}
            >
              {o.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
