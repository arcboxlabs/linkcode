import type { AgentEvent, ContentBlock } from '@linkcode/schema';
import type { ReactNode } from 'react';

export interface MessageViewProps {
  events: AgentEvent[];
}

/** Render a normalized agent event stream. Covers every branch of the schema's AgentEvent. */
export function MessageView({ events }: MessageViewProps): ReactNode {
  if (events.length === 0) {
    return <p className="text-muted">暂无消息。</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {events.map((event, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: append-only event stream; index key is fine for the scaffold
        <EventRow key={i} event={event} />
      ))}
    </div>
  );
}

const ROW = 'whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed';

function contentText(c: ContentBlock): string {
  switch (c.type) {
    case 'text':
      return c.text;
    case 'image':
      return '[image]';
    case 'audio':
      return '[audio]';
    case 'resource_link':
      return `[resource: ${c.name}]`;
    case 'resource':
      return '[resource]';
  }
}

function EventRow({ event }: { event: AgentEvent }): ReactNode {
  switch (event.type) {
    case 'agent-message-chunk':
    case 'user-message-chunk':
      return <div className={`${ROW} text-text`}>{contentText(event.content)}</div>;
    case 'agent-thought-chunk':
      return <div className={`${ROW} italic text-muted`}>{contentText(event.content)}</div>;
    case 'tool-call':
      return (
        <div className={`${ROW} text-accent`}>
          ⚙ {event.toolCall.title} <span className="text-muted">· {event.toolCall.status}</span>
        </div>
      );
    case 'tool-call-update':
      return (
        <div className={`${ROW} text-accent`}>
          ⚙ {event.update.toolCallId} {event.update.status ?? ''}
        </div>
      );
    case 'plan':
      return (
        <div className={`${ROW} text-muted`}>
          ▤ {event.plan.entries.map((e) => e.content).join('; ')}
        </div>
      );
    case 'available-commands-update':
      return (
        <div className={`${ROW} text-muted`}>
          / {event.availableCommands.map((c) => c.name).join(', ')}
        </div>
      );
    case 'current-mode-update':
      return <div className={`${ROW} text-muted`}>mode · {event.currentModeId}</div>;
    case 'config-option-update':
      return <div className={`${ROW} text-muted`}>config updated</div>;
    case 'status':
      return <div className={`${ROW} text-muted`}>● {event.status}</div>;
    case 'token-usage':
      return (
        <div className={`${ROW} text-muted`}>
          ↯ in {event.usage.inputTokens ?? 0} / out {event.usage.outputTokens ?? 0}
        </div>
      );
    case 'stop':
      return <div className={`${ROW} text-muted`}>■ {event.stopReason}</div>;
    case 'error':
      return <div className={`${ROW} text-danger`}>⚠ {event.message}</div>;
    case 'permission-request':
      return (
        <div className={`${ROW} text-accent`}>
          ⏵ 权限请求 · {event.toolCall.title ?? event.toolCall.toolCallId}
        </div>
      );
    case 'client-request':
      return <div className={`${ROW} text-muted`}>⏵ {event.request.method}</div>;
  }
}
