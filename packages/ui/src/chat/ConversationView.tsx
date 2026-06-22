import type { AgentKind } from '@linkcode/schema';
import { Spinner } from 'coss-ui/components/spinner';
import { type ReactElement, useEffect, useRef } from 'react';
import { useTranslations } from 'use-intl';
import { AssistantMessage } from './AssistantMessage';
import { ErrorMessage } from './ErrorMessage';
import { PermissionCard } from './PermissionCard';
import { PlanCard } from './PlanCard';
import { ThoughtBlock } from './ThoughtBlock';
import { ToolCallItem } from './ToolCallItem';
import type { ConversationViewModel } from './types';
import { UserMessage } from './UserMessage';

export interface ConversationViewProps {
  conversation: ConversationViewModel;
  agentKind?: AgentKind;
  cwd?: string;
  /** requestIds the user already answered in this client. */
  answeredPermissions: Set<string>;
  /** requestIds currently being sent to the daemon. */
  respondingPermissions: Set<string>;
  /** requestIds still awaiting a decision (from the normalizer); others are treated as resolved. */
  pendingPermissions: Set<string>;
  onRespondPermission: (requestId: string, optionId: string) => void;
}

/** The centered message stream — the main reading surface. Auto-follows only while pinned to the bottom. */
export function ConversationView({
  conversation,
  agentKind,
  cwd,
  answeredPermissions,
  respondingPermissions,
  pendingPermissions,
  onRespondPermission,
}: ConversationViewProps): ReactElement {
  const t = useTranslations('workbench.conversation');
  const tk = useTranslations('workbench.agentKind');
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const { items } = conversation;
  const isThinking = conversation.status === 'running' || conversation.status === 'starting';

  function onScroll(): void {
    const el = scrollRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow new content only while pinned to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [items, isThinking]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <h2 className="font-medium text-foreground">{t('emptyTitle')}</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            {t('emptyHint', { agent: agentKind ? tk(agentKind) : 'agent', cwd: cwd ?? '.' })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="h-full overflow-y-auto"
      style={{
        maskImage:
          'linear-gradient(to bottom, transparent 0, black 24px, black calc(100% - 16px), transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0, black 24px, black calc(100% - 16px), transparent 100%)',
      }}
    >
      <div className="mx-auto max-w-[840px] space-y-3 px-5 py-6">
        {items.map((item) => {
          switch (item.kind) {
            case 'user-message':
              return <UserMessage key={item.id} blocks={item.blocks} />;
            case 'assistant-message':
              return <AssistantMessage key={item.id} blocks={item.blocks} />;
            case 'thought':
              return <ThoughtBlock key={item.id} blocks={item.blocks} />;
            case 'tool-call':
              return <ToolCallItem key={item.id} toolCall={item.toolCall} />;
            case 'plan':
              return <PlanCard key={item.id} plan={item.plan} />;
            case 'permission':
              return (
                <PermissionCard
                  key={item.id}
                  toolCall={item.toolCall}
                  options={item.options}
                  answered={
                    answeredPermissions.has(item.requestId) ||
                    !pendingPermissions.has(item.requestId)
                  }
                  responding={respondingPermissions.has(item.requestId)}
                  onRespond={(optionId) => onRespondPermission(item.requestId, optionId)}
                />
              );
            case 'client-request':
              return (
                <div key={item.id} className="font-mono text-[12px] text-muted-foreground">
                  ⏵ {item.request.method}
                </div>
              );
            case 'error':
              return (
                <ErrorMessage
                  key={item.id}
                  message={item.message}
                  code={item.code}
                  recoverable={item.recoverable}
                />
              );
            default:
              return null;
          }
        })}
        {isThinking && (
          <div className="flex items-center gap-2 py-1 text-muted-foreground text-[13px]">
            <Spinner className="size-3.5" />
            <span>{t('thinking')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
