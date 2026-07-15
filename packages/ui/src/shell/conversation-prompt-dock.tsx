import type { PermissionOption, QuestionOutcome, ToolCallUpdate } from '@linkcode/schema';
import { ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { CircularProgress } from '../chat/circular-progress';
import type {
  ConversationPromptChoice,
  ConversationPromptMode,
  ConversationPromptResponse,
  ConversationPromptTone,
} from '../chat/conversation-prompt';
import { ConversationPromptAlert } from '../chat/conversation-prompt-alert';
import type {
  CurrentPlan,
  PermissionConversationItem,
  PermissionDecision,
  PromptPageCursor,
  QuestionConversationItem,
} from '../chat/conversation-prompts';
import {
  resolvePromptPageIndex,
  selectCurrentPlan,
  selectPendingPromptItems,
} from '../chat/conversation-prompts';
import { Step, StepContent, StepHeader, StepItem } from '../chat/step';
import type { ConversationViewModel } from '../chat/types';
import { cn } from '../lib/cn';
import { PromptPager } from './prompt-pager';
import { QuestionPrompt } from './question-prompt';

interface MockConversationPrompt {
  promptId: string;
  title: string;
  badge: string;
  tone?: ConversationPromptTone;
  mode: ConversationPromptMode;
  choices: readonly ConversationPromptChoice[];
  details?: ReadonlyArray<{ label: string; value: string; monospace?: boolean }>;
}

type StandalonePrompt =
  | { kind: 'permission'; promptId: string; item: PermissionConversationItem }
  | { kind: 'mock'; promptId: string; prompt: MockConversationPrompt };

type QuestionPromptGroup =
  | { kind: 'question'; promptId: string; item: QuestionConversationItem }
  | { kind: 'mock-question'; promptId: string; item: QuestionConversationItem };

type PromptGroup = StandalonePrompt | QuestionPromptGroup;

const EMPTY_MOCK_PROMPTS: MockConversationPrompt[] = [];
const EMPTY_PROMPT_RESPONSE: ConversationPromptResponse = { selectedIds: [] };
const MOCK_QUESTION_BATCH_ID = 'mock-question-batch';

// Frontend-only fixtures keep every prompt shape visible in mock-showcase mode.
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

// TODO(CODE-159): Replace this frontend request/response stub when Codex requestUserInput is
// normalized into one QuestionConversationItem and one aggregate QuestionOutcome by the adapter.
const MOCK_SHOWCASE_QUESTION: QuestionConversationItem = {
  kind: 'question',
  id: MOCK_QUESTION_BATCH_ID,
  turnId: null,
  requestId: MOCK_QUESTION_BATCH_ID,
  toolCall: { toolCallId: MOCK_QUESTION_BATCH_ID, title: 'Request user input' },
  questions: [
    {
      questionId: 'scope',
      prompt: 'How broad should the change be?',
      header: 'Scope',
      multiSelect: false,
      options: [
        { optionId: 'focused', label: 'Focused', description: 'Only the requested behavior.' },
        { optionId: 'broad', label: 'Broad', description: 'Include adjacent cleanup.' },
      ],
    },
    {
      questionId: 'checks',
      prompt: 'Which checks should run?',
      header: 'Checks',
      multiSelect: true,
      options: [
        { optionId: 'targeted', label: 'Targeted tests' },
        { optionId: 'full', label: 'Full suite' },
      ],
    },
    {
      questionId: 'handoff',
      prompt: 'How should the result be handed off?',
      header: 'Handoff',
      multiSelect: false,
      options: [
        { optionId: 'summary', label: 'Summary' },
        { optionId: 'details', label: 'Detailed notes' },
      ],
    },
  ],
};

/** Actionable prompts pinned above the composer: the current plan and pending permission/question asks. */
export function ConversationPromptDock({
  conversation,
  permissionDecisions,
  respondingPermissions,
  answeredQuestionIds,
  respondingQuestions,
  onRespondPermission,
  onRespondQuestion,
}: {
  conversation: ConversationViewModel;
  permissionDecisions: ReadonlyMap<string, PermissionDecision>;
  respondingPermissions: ReadonlySet<string>;
  answeredQuestionIds: ReadonlySet<string>;
  respondingQuestions: ReadonlySet<string>;
  onRespondPermission: (requestId: string, decision: PermissionDecision) => void;
  onRespondQuestion: (requestId: string, outcome: QuestionOutcome) => void;
}): React.ReactNode {
  const plan = selectCurrentPlan(conversation);
  const [dismissedMockPromptIds, setDismissedMockPromptIds] = useState<string[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [selectedPromptSegmentId, setSelectedPromptSegmentId] = useState<string | null>(null);
  const [selectedPromptIndex, setSelectedPromptIndex] = useState(0);
  const [standaloneResponses, setStandaloneResponses] = useState<
    Record<string, ConversationPromptResponse>
  >({});
  const [autoFocusPromptId, setAutoFocusPromptId] = useState<string | null>(null);

  const pendingAgentGroups: PromptGroup[] = [];
  for (const item of selectPendingPromptItems(conversation)) {
    if (item.kind === 'approval') {
      if (!permissionDecisions.has(item.requestId)) {
        pendingAgentGroups.push({
          kind: 'permission',
          promptId: `permission:${item.requestId}`,
          item,
        });
      }
    } else if (!answeredQuestionIds.has(item.requestId)) {
      pendingAgentGroups.push({
        kind: 'question',
        promptId: `question:${item.requestId}`,
        item,
      });
    }
  }

  const mockPrompts =
    conversation.currentModeId === 'mock-showcase' ? MOCK_SHOWCASE_PROMPTS : EMPTY_MOCK_PROMPTS;
  const pendingMockPrompts = mockPrompts.filter(
    (prompt) => !dismissedMockPromptIds.includes(prompt.promptId),
  );
  const pendingMockQuestions: PromptGroup[] =
    conversation.currentModeId === 'mock-showcase' &&
    !dismissedMockPromptIds.includes(MOCK_QUESTION_BATCH_ID)
      ? [
          {
            kind: 'mock-question',
            promptId: `mock-question:${MOCK_QUESTION_BATCH_ID}`,
            item: MOCK_SHOWCASE_QUESTION,
          },
        ]
      : [];
  const pendingMockGroups: PromptGroup[] = [
    ...pendingMockQuestions,
    ...pendingMockPrompts.map(
      (prompt): PromptGroup => ({
        kind: 'mock',
        promptId: `mock:${prompt.promptId}`,
        prompt,
      }),
    ),
  ];
  // Mock fixtures are seeded when the showcase opens, so later live events must queue behind them.
  const pendingGroups = [...pendingMockGroups, ...pendingAgentGroups];
  const firstGroup = pendingGroups.at(0);
  const currentQuestionGroup = firstGroup && isQuestionGroup(firstGroup) ? firstGroup : null;
  const standalonePrompts: StandalonePrompt[] = [];
  if (!currentQuestionGroup) {
    for (const group of pendingGroups) {
      if (isQuestionGroup(group)) break;
      standalonePrompts.push(group);
    }
  }
  const promptCursor: PromptPageCursor = {
    promptId: selectedPromptId,
    segmentId: selectedPromptSegmentId,
    index: selectedPromptIndex,
  };
  const pageIndex = resolvePromptPageIndex(standalonePrompts, promptCursor);
  const currentStandalonePrompt = standalonePrompts.at(pageIndex) ?? null;
  const currentGroup = currentQuestionGroup ?? currentStandalonePrompt;

  if (!plan && !currentGroup) return null;

  const queuedCount = currentQuestionGroup
    ? pendingGroups.length - 1
    : pendingGroups.length - standalonePrompts.length;

  function selectStandalonePage(index: number): void {
    const prompt = standalonePrompts[index];
    setAutoFocusPromptId(prompt.promptId);
    setSelectedPromptId(prompt.promptId);
    setSelectedPromptSegmentId(standalonePrompts[0].promptId);
    setSelectedPromptIndex(index);
  }

  function cursorAfterCurrent(): PromptPageCursor {
    if (currentQuestionGroup) {
      const next = pendingGroups.at(1);
      return { promptId: next?.promptId ?? null, segmentId: next?.promptId ?? null, index: 0 };
    }

    const next = standalonePrompts.at(pageIndex + 1);
    if (next) {
      return {
        promptId: next.promptId,
        segmentId: standalonePrompts[0].promptId,
        index: pageIndex,
      };
    }
    const previous = pageIndex > 0 ? standalonePrompts.at(pageIndex - 1) : undefined;
    if (previous) {
      return {
        promptId: previous.promptId,
        segmentId: standalonePrompts[0].promptId,
        index: pageIndex - 1,
      };
    }
    const boundary = pendingGroups.at(standalonePrompts.length);
    return {
      promptId: boundary?.promptId ?? null,
      segmentId: boundary?.promptId ?? null,
      index: 0,
    };
  }

  function prepareNextPrompt(): void {
    const cursor = cursorAfterCurrent();
    setAutoFocusPromptId(cursor.promptId);
    setSelectedPromptId(cursor.promptId);
    setSelectedPromptSegmentId(cursor.segmentId);
    setSelectedPromptIndex(cursor.index);
  }

  function dismissMockPrompt(promptId: string): void {
    prepareNextPrompt();
    setDismissedMockPromptIds((current) =>
      current.includes(promptId) ? current : [...current, promptId],
    );
  }

  function respondToPermission(requestId: string, decision: PermissionDecision): void {
    prepareNextPrompt();
    onRespondPermission(requestId, decision);
  }

  function respondToQuestion(requestId: string, outcome: QuestionOutcome): void {
    prepareNextPrompt();
    onRespondQuestion(requestId, outcome);
  }

  const standalonePager =
    currentStandalonePrompt && (standalonePrompts.length > 1 || queuedCount > 0) ? (
      <PromptPager
        current={pageIndex + 1}
        queued={queuedCount}
        total={standalonePrompts.length}
        onNext={() => selectStandalonePage(pageIndex + 1)}
        onPrevious={() => selectStandalonePage(pageIndex - 1)}
      />
    ) : undefined;

  return (
    <div className="shrink-0 px-4 py-2">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {/* A question group is a hard boundary; standalone prompts page only within its prefix. */}
        {currentGroup?.kind === 'permission' ? (
          <PermissionPrompt
            key={currentGroup.promptId}
            action={standalonePager}
            autoFocusFirstChoice={autoFocusPromptId === currentGroup.promptId}
            item={currentGroup.item}
            respondingPermissions={respondingPermissions}
            onRespondPermission={respondToPermission}
          />
        ) : currentGroup?.kind === 'question' ? (
          <QuestionPrompt
            key={currentGroup.promptId}
            autoFocusFirstChoice={autoFocusPromptId === currentGroup.promptId}
            item={currentGroup.item}
            queuedCount={queuedCount}
            responding={respondingQuestions.has(currentGroup.item.requestId)}
            onRespond={respondToQuestion}
          />
        ) : currentGroup?.kind === 'mock-question' ? (
          <QuestionPrompt
            key={currentGroup.promptId}
            autoFocusFirstChoice={autoFocusPromptId === currentGroup.promptId}
            item={currentGroup.item}
            queuedCount={queuedCount}
            responding={false}
            onRespond={() => dismissMockPrompt(MOCK_QUESTION_BATCH_ID)}
          />
        ) : currentGroup ? (
          <ConversationPromptAlert
            key={currentGroup.promptId}
            action={standalonePager}
            autoFocusFirstChoice={autoFocusPromptId === currentGroup.promptId}
            badge={currentGroup.prompt.badge}
            choices={currentGroup.prompt.choices}
            details={currentGroup.prompt.details}
            mode={currentGroup.prompt.mode}
            response={standaloneResponses[currentGroup.promptId] ?? EMPTY_PROMPT_RESPONSE}
            tone={currentGroup.prompt.tone}
            title={currentGroup.prompt.title}
            onResponseChange={(response) =>
              setStandaloneResponses((current) => ({
                ...current,
                [currentGroup.promptId]: response,
              }))
            }
            onSkip={() => dismissMockPrompt(currentGroup.prompt.promptId)}
            onSubmit={() => dismissMockPrompt(currentGroup.prompt.promptId)}
          />
        ) : null}
        {plan ? <StepPromptRow plan={plan} /> : null}
      </div>
    </div>
  );
}

function isQuestionGroup(group: PromptGroup): group is QuestionPromptGroup {
  return group.kind === 'question' || group.kind === 'mock-question';
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
  autoFocusFirstChoice,
  item,
  respondingPermissions,
  onRespondPermission,
}: {
  action?: React.ReactNode;
  autoFocusFirstChoice: boolean;
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
      autoFocusFirstChoice={autoFocusFirstChoice}
      badge={kindLabel}
      choices={permissionChoices(item.options)}
      // TODO(backend): enable once permission responses can carry a steering comment.
      customInputDisabled
      customInputPlaceholder={t('steerPlaceholder')}
      details={permissionDetails(item.toolCall).map((detail) => ({
        label: t(detail.label),
        value: detail.value,
        monospace: true,
        multiline: detail.label === 'arguments',
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
    // Custom/MCP approvals have no normalized argument schema. Preserve rawInput only on this
    // approval surface; normal transcript rendering intentionally keeps arbitrary payloads hidden.
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
