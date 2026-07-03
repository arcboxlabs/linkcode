import type { PermissionOption, ToolCallUpdate } from '@linkcode/schema';
import { AlertAction } from 'coss-ui/components/alert';
import { Badge } from 'coss-ui/components/badge';
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

interface PermissionDetail {
  label: 'file' | 'command' | 'url';
  value: string;
}

/** Pull the concrete ask (files touched, command to run, URL to fetch) out of the tool call. */
function permissionDetails(toolCall: ToolCallUpdate): PermissionDetail[] {
  const raw = isRecord(toolCall.rawInput) ? toolCall.rawInput : undefined;

  const files = new Set<string>();
  for (const item of toolCall.content ?? []) {
    if (item.type === 'diff') files.add(item.path);
  }
  for (const location of toolCall.locations ?? []) files.add(location.path);
  const rawPath = stringField(raw, 'path') ?? stringField(raw, 'file_path');
  if (rawPath) files.add(rawPath);

  const details: PermissionDetail[] = [...files].map((value) => ({ label: 'file', value }));
  const command = stringField(raw, 'command');
  if (command) details.push({ label: 'command', value: command });
  const url = stringField(raw, 'url');
  if (url) details.push({ label: 'url', value: url });
  return details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringField(raw: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = raw?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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
  const tTool = useTranslations('workbench.tool');
  const details = permissionDetails(toolCall);
  const kindLabel = toolCall.kind
    ? tTool(`kind${toolCall.kind[0].toUpperCase()}${toolCall.kind.slice(1)}`)
    : null;

  return (
    <Confirmation className={className}>
      <ConfirmationTitle title={t('title')}>
        {t('title')}
        {kindLabel ? (
          <Badge size="sm" variant="secondary">
            {kindLabel}
          </Badge>
        ) : null}
        <span className="min-w-0 truncate font-normal text-muted-foreground">
          {toolCall.title ?? toolCall.toolCallId}
        </span>
      </ConfirmationTitle>
      {pager ? <AlertAction>{pager}</AlertAction> : null}
      {details.length > 0 && (
        <ConfirmationDescription>
          <div className="min-w-0 space-y-0.5">
            {details.map((detail) => (
              <div
                key={`${detail.label}:${detail.value}`}
                className="flex min-w-0 items-baseline gap-2"
              >
                <span className="shrink-0 text-muted-foreground text-xs">{t(detail.label)}</span>
                <code className="min-w-0 truncate font-mono text-xs">{detail.value}</code>
              </div>
            ))}
          </div>
        </ConfirmationDescription>
      )}
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
