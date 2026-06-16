import type { AgentEvent } from '@linkcode/schema';
import type { ReactNode } from 'react';

export interface MessageViewProps {
  events: AgentEvent[];
}

/** Render a normalized agent event stream. Covers all branches of the schema's AgentEvent. */
export function MessageView({ events }: MessageViewProps): ReactNode {
  if (events.length === 0) {
    return <p className="text-muted">暂无消息。</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {events.map((event, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the event stream is an append-only list, so we use index as the key during the scaffolding phase
        <EventRow key={i} event={event} />
      ))}
    </div>
  );
}

const ROW = 'whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed';

function EventRow({ event }: { event: AgentEvent }): ReactNode {
  switch (event.type) {
    case 'assistant-delta':
      return <div className={`${ROW} text-text`}>{event.text}</div>;
    case 'tool-call':
      return <div className={`${ROW} text-accent`}>⚙ {event.call.name}</div>;
    case 'tool-result':
      return (
        <div className={`${ROW} ${event.ok ? 'text-success' : 'text-danger'}`}>
          {event.ok ? '✓' : '✗'} tool {event.callId}
        </div>
      );
    case 'status':
      return <div className={`${ROW} text-muted`}>● {event.status}</div>;
    case 'error':
      return <div className={`${ROW} text-danger`}>⚠ {event.message}</div>;
  }
}
