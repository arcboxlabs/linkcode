import type { PermissionOption } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { ShieldAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import type { PermissionConversationItem, PermissionDecision } from '../chat/conversation-prompts';
import { mcpToolName } from '../chat/tool-utils';
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
  const rawTitle = item.title ?? item.toolCall.title ?? item.toolCall.toolCallId;
  const mcp = mcpToolName(rawTitle);
  // A permission judgment needs provenance, so the MCP server rides along with the tool name.
  const title = mcp ? `${mcp.tool} · ${mcp.server}` : rawTitle;
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
      description={item.description ?? t('reviewDescription')}
      details={permissionDetails(item).map((detail) => ({
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
  label: 'arguments' | 'command' | 'file' | 'url' | 'workingDirectory';
  value: string;
}

function permissionDetails(item: PermissionConversationItem): PermissionDetail[] {
  const { subject, toolCall } = item;
  const raw = isRecord(toolCall.rawInput) ? toolCall.rawInput : undefined;
  // Unrecognized tools show their whole input as one JSON row; extracting raw fields into
  // dedicated rows as well would render the same data twice.
  const showRawArguments = toolCall.kind === 'other' && raw !== undefined;

  const files = new Set<string>();
  for (const item of toolCall.content ?? []) {
    if (item.type === 'diff') files.add(item.path);
  }
  for (const location of toolCall.locations ?? []) files.add(location.path);
  if (!showRawArguments) {
    const rawPath = stringField(raw, 'path') ?? stringField(raw, 'file_path');
    if (rawPath) files.add(rawPath);
  }

  const details: PermissionDetail[] = [...files].map((value) => ({ label: 'file', value }));
  if (showRawArguments) {
    details.push({ label: 'arguments', value: JSON.stringify(raw, null, 2) });
  } else {
    const command = subject?.type === 'command' ? subject.command : stringField(raw, 'command');
    if (command) details.push({ label: 'command', value: command });
    if (subject?.type === 'command') {
      details.push({ label: 'workingDirectory', value: subject.cwd });
    }
    const url = stringField(raw, 'url');
    if (url) details.push({ label: 'url', value: url });
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
