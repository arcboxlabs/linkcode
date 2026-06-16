import type { AgentEvent, AgentInput, SessionId } from '@linkcode/schema';
import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import type { LinkCodeClient } from './client';

const ClientContext = createContext<LinkCodeClient | null>(null);

export function LinkCodeProvider(props: {
  client: LinkCodeClient;
  children: ReactNode;
}): ReactNode {
  return <ClientContext.Provider value={props.client}>{props.children}</ClientContext.Provider>;
}

export function useLinkCodeClient(): LinkCodeClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error('useLinkCodeClient 必须在 <LinkCodeProvider> 内使用');
  return client;
}

/** 订阅某会话的归一化事件流，累积为列表（push 模型）。 */
export function useAgentEvents(sessionId: SessionId | null): AgentEvent[] {
  const client = useLinkCodeClient();
  const [events, setEvents] = useState<AgentEvent[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    setEvents([]);
    return client.subscribe(sessionId, (event) => {
      setEvents((prev) => [...prev, event]);
    });
  }, [client, sessionId]);

  return events;
}

/** 返回一个向当前会话发送输入的函数。 */
export function useSendInput(sessionId: SessionId | null): (input: AgentInput) => void {
  const client = useLinkCodeClient();
  return (input: AgentInput) => {
    if (sessionId) client.send(sessionId, input);
  };
}
