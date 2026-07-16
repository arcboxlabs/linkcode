import type { PermissionOption, ToolCallUpdate } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { ShieldAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import type { PermissionConversationItem, PermissionDecision } from '../chat/conversation-prompts';
import { PromptCard } from './prompt-card';

export function PermissionPrompt({
  error,
  item,
  queuedCount = 0,
  responding,
  onRespond,
}: {
  error?: string;
  item: PermissionConversationItem;
  queuedCount?: number;
  responding: boolean;
  onRespond: (requestId: string, decision: PermissionDecision) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.permission');
  const tp = useTranslations('workbench.prompt');
  const [lastDecision, setLastDecision] = useState<PermissionDecision | null>(null);
  const selectedOptionId =
    lastDecision?.outcome === 'selected' ? lastDecision.option.optionId : undefined;
  const title = item.toolCall.title ?? item.toolCall.toolCallId;
  const persistentOptions = item.options.filter((option) => option.kind.endsWith('_always'));
  const immediateOptions = item.options
    .filter((option) => !option.kind.endsWith('_always'))
    .toSorted((left, right) => permissionOptionPriority(left) - permissionOptionPriority(right));

  function respond(decision: PermissionDecision): void {
    if (responding) return;
    setLastDecision(decision);
    onRespond(item.requestId, decision);
  }

  return (
    <PromptCard
      busyLabel={lastDecision ? undefined : t('responding')}
      description={t('reviewDescription')}
      details={permissionDetails(item.toolCall).map((detail) => ({
        label: t(detail.label),
        value: detail.value,
        monospace: true,
        multiline: true,
      }))}
      disabled={responding}
      error={
        error && lastDecision
          ? {
              message: error,
              retryLabel: tp('retry'),
              onRetry: () => respond(lastDecision),
            }
          : undefined
      }
      footer={
        <>
          {persistentOptions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {persistentOptions.map((option) => (
                <PermissionOptionButton
                  key={option.optionId}
                  option={option}
                  responding={responding}
                  selectedOptionId={selectedOptionId}
                  onSelect={() => respond({ outcome: 'selected', option })}
                />
              ))}
            </div>
          ) : null}
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            {immediateOptions.map((option) => (
              <PermissionOptionButton
                key={option.optionId}
                option={option}
                responding={responding}
                selectedOptionId={selectedOptionId}
                onSelect={() => respond({ outcome: 'selected', option })}
              />
            ))}
          </div>
        </>
      }
      eyebrow={
        <Badge className="w-fit" variant="warning">
          <ShieldAlertIcon />
          {t('reviewRequired')}
        </Badge>
      }
      meta={
        queuedCount > 0 ? (
          <span aria-live="polite" className="text-muted-foreground text-xs">
            {tp('queued', { count: queuedCount })}
          </span>
        ) : undefined
      }
      title={t('question', { action: title })}
      tone="warning"
    />
  );
}

function PermissionOptionButton({
  option,
  responding,
  selectedOptionId,
  onSelect,
}: {
  option: PermissionOption;
  responding: boolean;
  selectedOptionId: string | undefined;
  onSelect: () => void;
}): React.ReactNode {
  return (
    <Button
      disabled={responding}
      loading={responding && selectedOptionId === option.optionId}
      size="xs"
      variant={permissionButtonVariant(option)}
      onClick={onSelect}
    >
      {option.name}
    </Button>
  );
}

function permissionButtonVariant(
  option: PermissionOption,
): React.ComponentProps<typeof Button>['variant'] {
  if (option.kind === 'reject_always') return 'destructive-outline';
  if (option.kind === 'reject_once') return 'outline';
  if (option.kind === 'allow_always') return 'ghost';
  return 'default';
}

function permissionOptionPriority(option: PermissionOption): number {
  return option.kind.startsWith('reject') ? 0 : 1;
}

interface PermissionDetail {
  label: 'arguments' | 'file' | 'command' | 'url';
  value: string;
}

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
  if (toolCall.kind === 'other' && raw) {
    details.push({ label: 'arguments', value: JSON.stringify(raw, null, 2) });
  }
  return details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(raw: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = raw?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
