import type { PermissionOption, ToolCallUpdate } from '@linkcode/schema';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from 'coss-ui/components/pagination';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { CircularProgress } from '../chat/circular-progress';
import type {
  ConversationPromptChoice,
  ConversationPromptMode,
  ConversationPromptTone,
} from '../chat/conversation-prompt';
import { ConversationPromptAlert } from '../chat/conversation-prompt-alert';
import type {
  CurrentPlan,
  PermissionConversationItem,
  PermissionDecision,
  PromptPageCursor,
} from '../chat/conversation-prompts';
import {
  resolvePromptPageIndex,
  selectCurrentPlan,
  selectPendingPermissionItems,
} from '../chat/conversation-prompts';
import { Step, StepContent, StepHeader, StepItem } from '../chat/step';
import type { ConversationViewModel } from '../chat/types';
import { cn } from '../lib/cn';

interface MockConversationPrompt {
  promptId: string;
  title: string;
  badge: string;
  tone?: ConversationPromptTone;
  mode: ConversationPromptMode;
  choices: readonly ConversationPromptChoice[];
  details?: ReadonlyArray<{ label: string; value: string; monospace?: boolean }>;
}

type PromptQueueItem =
  | { kind: 'permission'; promptId: string; item: PermissionConversationItem }
  | { kind: 'mock'; promptId: string; prompt: MockConversationPrompt };

const EMPTY_MOCK_PROMPTS: MockConversationPrompt[] = [];

// Frontend-only fixtures keep every prompt shape visible until backend prompt events exist.
const MOCK_SHOWCASE_PROMPTS: MockConversationPrompt[] = [
  {
    promptId: 'mock-prompt-single',
    title: 'Pick the mock summary style',
    badge: 'Single',
    mode: 'single',
    details: [{ label: 'Mock', value: 'single choice' }],
    choices: [
      { id: 'brief', label: 'Brief', description: 'Keep the response compact.' },
      { id: 'detailed', label: 'Detailed', description: 'Include implementation notes.' },
      { id: 'risks', label: 'Risk-focused', description: 'Lead with caveats and checks.' },
    ],
  },
  {
    promptId: 'mock-prompt-multiple',
    title: 'Select prompt surfaces to keep visible',
    badge: 'Multiple',
    mode: 'multiple',
    details: [{ label: 'Mock', value: 'multiple choice' }],
    choices: [
      { id: 'permissions', label: 'Permission asks', description: 'Existing command/tool asks.' },
      { id: 'questions', label: 'Agent questions', description: 'TODO(backend) prompt events.' },
      {
        id: 'plan-review',
        label: 'Plan review approval',
        description: 'TODO(backend) explicit plan review asks.',
      },
    ],
  },
];

/** Actionable prompts pinned above the composer: the current plan and pending permission asks. */
export function ConversationPromptDock({
  conversation,
  permissionDecisions,
  respondingPermissions,
  onRespondPermission,
}: {
  conversation: ConversationViewModel;
  permissionDecisions: ReadonlyMap<string, PermissionDecision>;
  respondingPermissions: ReadonlySet<string>;
  onRespondPermission: (requestId: string, decision: PermissionDecision) => void;
}): React.ReactNode {
  const plan = selectCurrentPlan(conversation);
  const pendingPermissions = selectPendingPermissionItems(conversation).filter(
    (item) => !permissionDecisions.has(item.requestId),
  );
  const [dismissedMockPromptIds, setDismissedMockPromptIds] = useState<string[]>([]);
  const [promptCursor, setPromptCursor] = useState<PromptPageCursor>({
    promptId: null,
    index: 0,
  });
  const mockPrompts =
    conversation.currentModeId === 'mock-showcase' ? MOCK_SHOWCASE_PROMPTS : EMPTY_MOCK_PROMPTS;
  const pendingMockPrompts = mockPrompts.filter(
    (prompt) => !dismissedMockPromptIds.includes(prompt.promptId),
  );
  const pendingPrompts: PromptQueueItem[] = [
    ...pendingPermissions.map(
      (item): PromptQueueItem => ({
        kind: 'permission',
        promptId: `permission:${item.requestId}`,
        item,
      }),
    ),
    ...pendingMockPrompts.map(
      (prompt): PromptQueueItem => ({
        kind: 'mock',
        promptId: `mock:${prompt.promptId}`,
        prompt,
      }),
    ),
  ];
  const pageIndex = resolvePromptPageIndex(pendingPrompts, promptCursor);
  const hasPrompts = pendingPrompts.length > 0;

  if (!plan && !hasPrompts) return null;

  const currentPrompt = hasPrompts ? pendingPrompts[pageIndex] : null;

  function selectPromptPage(index: number): void {
    const prompt = pendingPrompts[index];
    setPromptCursor({ promptId: prompt.promptId, index });
  }

  function dismissMockPrompt(promptId: string): void {
    setDismissedMockPromptIds((current) =>
      current.includes(promptId) ? current : [...current, promptId],
    );
  }

  const pager =
    hasPrompts && pendingPrompts.length > 1 ? (
      <PromptPager
        current={pageIndex + 1}
        total={pendingPrompts.length}
        onNext={() => selectPromptPage(pageIndex + 1)}
        onPrevious={() => selectPromptPage(pageIndex - 1)}
      />
    ) : undefined;

  return (
    <div className="shrink-0 px-4 py-2">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {/* One queue keeps every active prompt kind under the same pager. */}
        {currentPrompt?.kind === 'permission' ? (
          <PermissionPrompt
            key={currentPrompt.promptId}
            action={pager}
            item={currentPrompt.item}
            respondingPermissions={respondingPermissions}
            onRespondPermission={onRespondPermission}
          />
        ) : currentPrompt ? (
          <ConversationPromptAlert
            key={currentPrompt.promptId}
            action={pager}
            badge={currentPrompt.prompt.badge}
            choices={currentPrompt.prompt.choices}
            details={currentPrompt.prompt.details}
            mode={currentPrompt.prompt.mode}
            tone={currentPrompt.prompt.tone}
            title={currentPrompt.prompt.title}
            onSkip={() => dismissMockPrompt(currentPrompt.prompt.promptId)}
            onSubmit={() => dismissMockPrompt(currentPrompt.prompt.promptId)}
          />
        ) : null}
        {plan ? <StepPromptRow plan={plan} /> : null}
      </div>
    </div>
  );
}

function StepPromptRow({ plan }: { plan: CurrentPlan }): React.ReactNode {
  const t = useTranslations('workbench.step');
  const entry = plan.item.plan.entries[plan.currentIndex];

  return (
    <Step className="my-0 px-3 py-1.5" defaultOpen={false}>
      <StepHeader title={t('title')}>
        <CircularProgress
          className="size-3.5 shrink-0 text-muted-foreground"
          value={plan.currentIndex + 1}
          max={plan.total}
        />
        <span className="shrink-0">
          {t('title')} {t('progress', { current: plan.currentIndex + 1, total: plan.total })}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-normal text-muted-foreground',
            plan.complete && 'text-muted-foreground line-through',
          )}
        >
          {entry.content}
        </span>
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
      </StepHeader>
      <StepContent>
        {plan.item.plan.entries.map((item, index) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- plan is a full snapshot replaced per event; index+status is a stable position key
          <StepItem key={`${index}:${item.status}`} status={item.status}>
            {item.content}
          </StepItem>
        ))}
      </StepContent>
    </Step>
  );
}

function PermissionPrompt({
  action,
  item,
  respondingPermissions,
  onRespondPermission,
}: {
  action?: React.ReactNode;
  item: PermissionConversationItem;
  respondingPermissions: ReadonlySet<string>;
  onRespondPermission: (requestId: string, decision: PermissionDecision) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.permission');
  const tTool = useTranslations('workbench.tool');
  const title = item.toolCall.title ?? item.toolCall.toolCallId;
  const kindLabel = item.toolCall.kind
    ? tTool(`kind${item.toolCall.kind[0].toUpperCase()}${item.toolCall.kind.slice(1)}`)
    : undefined;

  return (
    <ConversationPromptAlert
      key={item.requestId}
      className="my-0"
      action={action}
      badge={kindLabel}
      choices={permissionChoices(item.options)}
      // TODO(backend): enable once permission responses can carry a steering comment.
      customInputDisabled
      customInputPlaceholder={t('steerPlaceholder')}
      details={permissionDetails(item.toolCall).map((detail) => ({
        label: t(detail.label),
        value: detail.value,
        monospace: true,
      }))}
      mode="single"
      submitting={respondingPermissions.has(item.requestId)}
      title={t('question', { action: title })}
      // Skip is a real cancellation outcome, not a synthetic "Reject" choice.
      onSkip={() => onRespondPermission(item.requestId, { outcome: 'cancelled' })}
      onSubmit={(response) => {
        if (response.customText) {
          // TODO(backend): send the steering text with the decline response instead of dropping it.
          onRespondPermission(item.requestId, { outcome: 'cancelled' });
          return;
        }
        const option = item.options.find(
          (candidate) => candidate.optionId === response.selectedIds[0],
        );
        if (option) onRespondPermission(item.requestId, { outcome: 'selected', option });
      }}
    />
  );
}

function permissionChoices(options: readonly PermissionOption[]): ConversationPromptChoice[] {
  return options.map((option) => ({
    id: option.optionId,
    label: option.name,
    tone: option.kind === 'reject_always' ? 'danger' : 'neutral',
  }));
}

interface PermissionDetail {
  label: 'file' | 'command' | 'url';
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
  return details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringField(raw: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = raw?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function PromptPager({
  current,
  total,
  onPrevious,
  onNext,
}: {
  current: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.prompt');

  if (total < 2) return null;

  return (
    <Pagination className="w-auto justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationLink
            aria-label={t('previous')}
            aria-disabled={current <= 1}
            className={cn(current <= 1 && 'pointer-events-none opacity-50')}
            href="#"
            size="icon-xs"
            tabIndex={current <= 1 ? -1 : 0}
            onClick={(event) => {
              event.preventDefault();
              if (current > 1) onPrevious();
            }}
          >
            <ChevronLeftIcon />
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <span className="flex h-6 items-center text-muted-foreground text-xs tabular-nums">
            {t('page', { current, total })}
          </span>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink
            aria-label={t('next')}
            aria-disabled={current >= total}
            className={cn(current >= total && 'pointer-events-none opacity-50')}
            href="#"
            size="icon-xs"
            tabIndex={current >= total ? -1 : 0}
            onClick={(event) => {
              event.preventDefault();
              if (current < total) onNext();
            }}
          >
            <ChevronRightIcon />
          </PaginationLink>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
