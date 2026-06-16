import type { AgentEvent } from '@linkcode/schema';
import type { CSSProperties, ReactNode } from 'react';
import { tokens } from './tokens';

export interface MessageViewProps {
  events: AgentEvent[];
}

/** 渲染一段归一化 agent 事件流。覆盖 schema 的 AgentEvent 全部分支。 */
export function MessageView({ events }: MessageViewProps): ReactNode {
  if (events.length === 0) {
    return (
      <p style={{ color: tokens.color.textMuted, fontFamily: tokens.font.sans }}>暂无消息。</p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space(2) }}>
      {events.map((event, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 事件流为只追加列表，脚手架阶段用 index 作 key
        <EventRow key={i} event={event} />
      ))}
    </div>
  );
}

function EventRow({ event }: { event: AgentEvent }): ReactNode {
  const row: CSSProperties = {
    fontFamily: tokens.font.mono,
    fontSize: 13,
    lineHeight: 1.5,
    color: tokens.color.text,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };
  switch (event.type) {
    case 'assistant-delta':
      return <div style={row}>{event.text}</div>;
    case 'tool-call':
      return <div style={{ ...row, color: tokens.color.accent }}>⚙ {event.call.name}</div>;
    case 'tool-result':
      return (
        <div style={{ ...row, color: event.ok ? tokens.color.success : tokens.color.danger }}>
          {event.ok ? '✓' : '✗'} tool {event.callId}
        </div>
      );
    case 'status':
      return <div style={{ ...row, color: tokens.color.textMuted }}>● {event.status}</div>;
    case 'error':
      return <div style={{ ...row, color: tokens.color.danger }}>⚠ {event.message}</div>;
  }
}
