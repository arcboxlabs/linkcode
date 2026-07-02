import type {
  AgentEvent,
  AgentInput,
  SessionId,
  SessionInfo,
  StartOptions,
} from '@linkcode/schema';
import { noop } from 'foxact/noop';
import { nullthrow } from 'foxact/nullthrow';
import type * as React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { LinkCodeClient, SequencedAgentEvent } from './client';
import type { Conversation } from './conversation';
import { buildConversation } from './conversation';

const ClientContext = createContext<LinkCodeClient | null>(null);

function reportClientActionError(action: string, error: unknown): void {
  console.error(`[LinkCode] ${action} failed`, error);
}

export function LinkCodeProvider({
  client,
  children,
}: React.PropsWithChildren<{
  client: LinkCodeClient;
}>): React.ReactNode {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useLinkCodeClient(): LinkCodeClient {
  return nullthrow(
    useContext(ClientContext),
    'useLinkCodeClient must be used within LinkCodeProvider',
  );
}

/**
 * Subscribe to a session's normalized event stream, accumulating it into a list (push model).
 * Each entry keeps its connection-scoped receive seq so consumers can align the stream against a
 * point-in-time transcript snapshot (see `mergeSeededEvents`).
 */
export function useSequencedAgentEvents(sessionId: SessionId | null): SequencedAgentEvent[] {
  const client = useLinkCodeClient();
  const [state, setState] = useState<{
    sessionId: SessionId | null;
    events: SequencedAgentEvent[];
  }>({
    sessionId: null,
    events: [],
  });

  useEffect(() => {
    if (!sessionId) return;
    return client.subscribe(sessionId, (event, seq) => {
      setState((prev) =>
        prev.sessionId === sessionId
          ? { sessionId, events: [...prev.events, { event, seq }] }
          : { sessionId, events: [{ event, seq }] },
      );
    });
  }, [client, sessionId]);

  return state.sessionId === sessionId ? state.events : [];
}

const NO_EVENTS: AgentEvent[] = [];

/** Subscribe to a session's normalized event stream, accumulating it into a list (push model). */
export function useAgentEvents(sessionId: SessionId | null): AgentEvent[] {
  const sequenced = useSequencedAgentEvents(sessionId);
  return useMemo(
    () => (sequenced.length === 0 ? NO_EVENTS : sequenced.map(({ event }) => event)),
    [sequenced],
  );
}

/** Subscribe to a terminal's output, accumulating it into a string for read-only display. */
export function useTerminalOutput(terminalId: string | null): string {
  const client = useLinkCodeClient();
  const [state, setState] = useState<{ id: string | null; output: string }>({
    id: null,
    output: '',
  });

  useEffect(() => {
    if (!terminalId) return;
    return client.subscribeTerminalOutput(terminalId, (data) => {
      setState((prev) =>
        prev.id === terminalId
          ? { id: terminalId, output: prev.output + data }
          : { id: terminalId, output: data },
      );
    });
  }, [client, terminalId]);

  return state.id === terminalId ? state.output : '';
}

/** Return a function that sends input to the current session. */
export function useSendInput(sessionId: SessionId | null): (input: AgentInput) => void {
  const client = useLinkCodeClient();
  return (input: AgentInput) => {
    if (sessionId) {
      void client
        .send(sessionId, input)
        .catch((error: unknown) => reportClientActionError('send', error));
    }
  };
}

/** Subscribe to a session and project its event stream into the structured conversation view-model. */
export function useConversation(sessionId: SessionId | null): Conversation {
  const events = useAgentEvents(sessionId);
  return useMemo(() => buildConversation(events), [events]);
}

export interface SessionsApi {
  /** Known sessions (daemon snapshot merged with ones created in this client), newest last. */
  sessions: SessionInfo[];
  /** The currently focused session, or null. */
  activeId: SessionId | null;
  /** Focus a session (or clear the selection). */
  select: (id: SessionId | null) => void;
  /** Start a new session, optimistically add it to the list, and focus it. */
  create: (opts: StartOptions) => Promise<SessionId>;
  /** Stop a session and drop it from the list. */
  stop: (id: SessionId) => void;
  /** Re-fetch the daemon's session list. */
  refresh: () => Promise<void>;
  /** True until the first refresh resolves. */
  loading: boolean;
}

/**
 * Session-inbox state shared by every client surface. The daemon has no "session list changed"
 * broadcast yet, so the list is seeded from `listSessions()` on connect and kept in sync optimistically
 * as this client creates/stops sessions.
 */
export function useSessions(): SessionsApi {
  const client = useLinkCodeClient();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<SessionId | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const list = await client.listSessions();
    setSessions((local) => {
      const byId = new Map<SessionId, SessionInfo>();
      for (const s of list) byId.set(s.sessionId, s);
      // Keep optimistic locals the snapshot doesn't know about yet.
      for (const s of local) if (!byId.has(s.sessionId)) byId.set(s.sessionId, s);
      return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
    });
    setLoading(false);
  }, [client]);

  useEffect(() => {
    client
      .listSessions()
      .then((list) => {
        setSessions((local) => {
          const byId = new Map<SessionId, SessionInfo>();
          for (const s of list) byId.set(s.sessionId, s);
          // Keep optimistic locals the snapshot doesn't know about yet.
          for (const s of local) if (!byId.has(s.sessionId)) byId.set(s.sessionId, s);
          return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
        });
      })
      .catch(noop)
      .finally(() => setLoading(false));
  }, [client]);

  const create = useCallback(
    async (opts: StartOptions): Promise<SessionId> => {
      const id = await client.startSession(opts);
      const optimistic: SessionInfo = {
        sessionId: id,
        kind: opts.kind,
        cwd: opts.cwd,
        status: 'starting',
        createdAt: Date.now(),
      };
      setSessions((prev) => (prev.some((s) => s.sessionId === id) ? prev : [...prev, optimistic]));
      setActiveId(id);
      return id;
    },
    [client],
  );

  const stop = useCallback(
    (id: SessionId) => {
      void client
        .stopSession(id)
        .then(() => {
          setSessions((prev) => prev.filter((s) => s.sessionId !== id));
          setActiveId((current) => (current === id ? null : current));
        })
        .catch((error: unknown) => reportClientActionError('stopSession', error));
    },
    [client],
  );

  return { sessions, activeId, select: setActiveId, create, stop, refresh, loading };
}
