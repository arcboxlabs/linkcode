import type {
  AgentEvent,
  AgentInput,
  SessionId,
  SessionInfo,
  StartOptions,
} from '@linkcode/schema';
import { noop } from 'foxact/noop';
import { nullthrow } from 'foxact/nullthrow';
import { useEffect } from 'foxact/use-abortable-effect';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { LinkCodeClient, SequencedAgentEvent } from './client';
import type { Conversation, ConversationSeed } from './conversation';
import { createConversationStore } from './conversation-store';

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

const NO_SEQUENCED_EVENTS: readonly SequencedAgentEvent[] = [];
const NO_EVENTS: AgentEvent[] = [];
const NO_TERMINAL_OUTPUT = '';

/**
 * Subscribe to a session's normalized event stream. The client's per-session buffer is the store,
 * so switching back to a session costs one cached array reference, not a replay through state.
 */
export function useAgentEvents(sessionId: SessionId | null): AgentEvent[] {
  const client = useLinkCodeClient();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!sessionId) return noop;
      return client.subscribe(sessionId, onStoreChange);
    },
    [client, sessionId],
  );
  const sequenced = useSyncExternalStore(subscribe, () =>
    sessionId ? client.eventsSnapshot(sessionId) : NO_SEQUENCED_EVENTS,
  );
  return useMemo(
    () => (sequenced.length === 0 ? NO_EVENTS : sequenced.map(({ event }) => event)),
    [sequenced],
  );
}

/** Subscribe to a terminal's accumulated output (read-only display) — the client's capped
 * per-terminal string buffer is the `useSyncExternalStore` store. */
export function useTerminalOutput(terminalId: string | null): string {
  const client = useLinkCodeClient();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!terminalId) return noop;
      return client.subscribeTerminalOutputSnapshot(terminalId, onStoreChange);
    },
    [client, terminalId],
  );
  return useSyncExternalStore(subscribe, () =>
    terminalId ? client.terminalOutputSnapshot(terminalId) : NO_TERMINAL_OUTPUT,
  );
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

/**
 * Subscribe to a session's structured conversation view-model, optionally seeded (see
 * `ConversationSeed`). Folds are O(delta) and unchanged items keep their identity, so memoized
 * message components skip re-rendering during streaming.
 */
export function useConversation(
  sessionId: SessionId | null,
  seed?: ConversationSeed,
): Conversation {
  const client = useLinkCodeClient();
  const store = useMemo(
    () => createConversationStore(client, sessionId, seed),
    [client, sessionId, seed],
  );
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export interface SessionsApi {
  /** Known sessions (daemon snapshot merged with ones created in this client), newest last. */
  sessions: SessionInfo[];
  /** The same sessions keyed by id: O(1) lookups for screens that re-render per stream delta. */
  sessionsById: ReadonlyMap<SessionId, SessionInfo>;
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
 * Session-inbox state shared by every client surface: seeded from `listSessions()` on connect,
 * synced optimistically on create/stop, and revalidated whenever the daemon announces that the
 * persisted list changed.
 */
export function useSessions(): SessionsApi {
  const client = useLinkCodeClient();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<SessionId | null>(null);
  const [loading, setLoading] = useState(true);

  // The daemon is the authority and now announces its own changes, so the snapshot replaces the
  // list outright. Merging local entries over it — the shape this hook used to protect an
  // optimistic create — is what made a removal impossible to observe.
  const refresh = useCallback(async () => {
    const list = await client.listSessions();
    setSessions([...list].sort((a, b) => a.createdAt - b.createdAt));
    setLoading(false);
  }, [client]);

  // A create settles as several frames (created, then its history binding and title), so a refetch
  // per frame would pull the whole list repeatedly: one in flight, one queued behind it.
  const revalidatingRef = useRef(false);
  const queuedRef = useRef(false);
  useEffect(() => {
    const takeQueued = (): boolean => {
      const queued = queuedRef.current;
      queuedRef.current = false;
      return queued;
    };
    const revalidate = async (): Promise<void> => {
      if (revalidatingRef.current) {
        queuedRef.current = true;
        return;
      }
      revalidatingRef.current = true;
      try {
        do {
          // eslint-disable-next-line no-await-in-loop -- serializing is the point: one fetch at a time
          await refresh();
        } while (takeQueued());
      } finally {
        revalidatingRef.current = false;
      }
    };
    return client.subscribeSessionChanged(() => {
      revalidate().catch(noop);
    });
  }, [client, refresh]);

  useEffect(
    (signal) => {
      refresh()
        .catch(noop)
        .finally(() => {
          if (!signal.aborted) setLoading(false);
        });
    },
    [refresh],
  );

  const create = useCallback(
    async (opts: StartOptions): Promise<SessionId> => {
      const id = await client.startSession(opts);
      // The daemon announces the create before it answers, so its snapshot already holds the
      // session; revalidating is both the insert and the confirmation.
      await refresh().catch(noop);
      setActiveId(id);
      return id;
    },
    [client, refresh],
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

  const sessionsById = useMemo(() => {
    const byId = new Map<SessionId, SessionInfo>();
    for (let i = 0, len = sessions.length; i < len; i++) {
      const session = sessions[i];
      byId.set(session.sessionId, session);
    }
    return byId;
  }, [sessions]);

  return { sessions, sessionsById, activeId, select: setActiveId, create, stop, refresh, loading };
}
