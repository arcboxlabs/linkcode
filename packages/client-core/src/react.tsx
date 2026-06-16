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

/** Subscribe to a session's normalized event stream, accumulating it into a list (push model). */
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

/** Return a function that sends input to the current session. */
export function useSendInput(sessionId: SessionId | null): (input: AgentInput) => void {
  const client = useLinkCodeClient();
  return (input: AgentInput) => {
    if (sessionId) client.send(sessionId, input);
  };
}
