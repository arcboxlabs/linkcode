import { createContext, use, useCallback } from 'react';
import type { SWRResponse } from 'swr';
import useSWR, { useSWRConfig } from 'swr';

/** A linked IM platform identity, as returned by the HQ `GET /im/accounts` endpoint. */
export interface CloudImAccount {
  platform: 'telegram';
  /** Platform-side user id (for Telegram, the numeric user id as a string). */
  accountId: string;
  /** ISO timestamp of when the identity was linked. */
  linkedAt: string;
}

/** A chat/group registered for the account (where the bot was linked from). */
export interface CloudImChat {
  chatId: string;
  title: string | null;
  createdAt: string;
}

export interface CloudImOverview {
  accounts: CloudImAccount[];
  chats: CloudImChat[];
  /** For t.me deep links; null when the shared bot is not configured server-side. */
  bot: { username: string } | null;
}

/** Per-account IM preferences; `chatId` targets auto-created topics while autoMirror is on. */
export interface CloudImPreferences {
  autoMirror: boolean;
  chatId: string | null;
}

export type CloudImBindResult =
  | { ok: true; chatId: string; topicId: string | null }
  | { ok: false; reason: 'exists' };

export interface CloudImBindingCreate {
  sessionId: string;
  chatId: string;
  title?: string;
  kind?: string;
  historyId?: string;
}

/** A live topic↔session binding held by the caller's relay (`GET /im/bindings`). */
export interface CloudImBinding {
  sessionId: string;
  platform: 'telegram';
  chatId: string;
  topicId: string;
  state: 'live' | 'muted';
  pushOut: boolean;
  acceptIn: boolean;
  createdFrom: 'im' | 'client';
  lastDeliveredSeq: number;
  /** Epoch millis of the binding's last state change. */
  updatedAt: number;
}

/**
 * Expected link failures are data, not exceptions: `not-found` is a wrong/expired code,
 * `conflict` means the Telegram identity is already linked to another LinkCode user.
 */
export type CloudImLinkResult = { ok: true } | { ok: false; reason: 'not-found' | 'conflict' };

/**
 * IM Channel management calls against the cloud API. Injected by the app because the credential
 * lives outside the data plane — desktop reads the keychain session in its main process and
 * exposes these over a bridge.
 */
export interface CloudImSource {
  overview: () => Promise<CloudImOverview>;
  bindings: () => Promise<CloudImBinding[]>;
  linkTelegram: (code: string) => Promise<CloudImLinkResult>;
  unlinkTelegram: () => Promise<void>;
  createBinding: (input: CloudImBindingCreate) => Promise<CloudImBindResult>;
  updateBinding: (sessionId: string, patch: { pushOut: boolean }) => Promise<void>;
  deleteBinding: (sessionId: string) => Promise<void>;
  preferences: () => Promise<CloudImPreferences>;
  setPreferences: (pref: CloudImPreferences) => Promise<void>;
}

const CloudImSourceContext = createContext<CloudImSource | null>(null);

/** Supplies the IM Channel fetchers to the data plane; workbench owns the SWR lifecycle. */
export function CloudImProvider({
  source,
  children,
}: {
  source: CloudImSource;
  children: React.ReactNode;
}): React.ReactNode {
  return <CloudImSourceContext value={source}>{children}</CloudImSourceContext>;
}

const IM_OVERVIEW_KEY = 'cloud/im/overview';
const IM_BINDINGS_KEY = 'cloud/im/bindings';
const IM_PREFERENCES_KEY = 'cloud/im/preferences';

/**
 * Linked IM accounts + registered chats. `enabled` gates the fetch on the caller's cloud session
 * so signed-out shells never hit the endpoint.
 */
export function useCloudImOverview(enabled: boolean): SWRResponse<CloudImOverview> {
  const source = use(CloudImSourceContext);
  return useSWR<CloudImOverview>(
    enabled && source ? IM_OVERVIEW_KEY : null,
    source ? source.overview : null,
    { revalidateOnFocus: true },
  );
}

/**
 * Topic↔session bindings on the caller's relay. Bindings change out-of-band (from Telegram or
 * the daemon), so revalidate on focus and on a slow interval.
 */
export function useCloudImBindings(enabled: boolean): SWRResponse<CloudImBinding[]> {
  const source = use(CloudImSourceContext);
  return useSWR<CloudImBinding[]>(
    enabled && source ? IM_BINDINGS_KEY : null,
    source ? source.bindings : null,
    { revalidateOnFocus: true, refreshInterval: 30000 },
  );
}

/** Per-account IM preferences (auto-mirror). Gate on the caller's cloud session. */
export function useCloudImPreferences(enabled: boolean): SWRResponse<CloudImPreferences> {
  const source = use(CloudImSourceContext);
  return useSWR<CloudImPreferences>(
    enabled && source ? IM_PREFERENCES_KEY : null,
    source ? source.preferences : null,
    { revalidateOnFocus: true },
  );
}

export interface CloudImActions {
  /** Confirms a `/link` code from the bot, then revalidates the overview. */
  linkTelegram: (code: string) => Promise<CloudImLinkResult>;
  /** Disconnects the Telegram account (identity, chats, and all relay bindings). */
  unlinkTelegram: () => Promise<void>;
  /** Binds a session to a fresh topic in the given chat (client-initiated). */
  createBinding: (input: CloudImBindingCreate) => Promise<CloudImBindResult>;
  /** Toggles push delivery for one binding (pause/resume). */
  setBindingPush: (sessionId: string, pushOut: boolean) => Promise<void>;
  /** Unbinds a session from its topic (the topic itself is kept on the platform). */
  deleteBinding: (sessionId: string) => Promise<void>;
  setPreferences: (pref: CloudImPreferences) => Promise<void>;
}

/** Mutations over the injected source; each settles the affected SWR keys before resolving. */
export function useCloudImActions(): CloudImActions | null {
  const source = use(CloudImSourceContext);
  const { mutate } = useSWRConfig();

  const linkTelegram = useCallback(
    async (code: string) => {
      if (!source) throw new Error('CloudImProvider missing');
      const result = await source.linkTelegram(code);
      if (result.ok) await mutate(IM_OVERVIEW_KEY);
      return result;
    },
    [source, mutate],
  );

  const unlinkTelegram = useCallback(async () => {
    if (!source) throw new Error('CloudImProvider missing');
    await source.unlinkTelegram();
    await Promise.all([
      mutate(IM_OVERVIEW_KEY),
      mutate(IM_BINDINGS_KEY),
      mutate(IM_PREFERENCES_KEY),
    ]);
  }, [source, mutate]);

  const createBinding = useCallback(
    async (input: CloudImBindingCreate) => {
      if (!source) throw new Error('CloudImProvider missing');
      const result = await source.createBinding(input);
      await mutate(IM_BINDINGS_KEY);
      return result;
    },
    [source, mutate],
  );

  const setBindingPush = useCallback(
    async (sessionId: string, pushOut: boolean) => {
      if (!source) throw new Error('CloudImProvider missing');
      await source.updateBinding(sessionId, { pushOut });
      await mutate(IM_BINDINGS_KEY);
    },
    [source, mutate],
  );

  const deleteBinding = useCallback(
    async (sessionId: string) => {
      if (!source) throw new Error('CloudImProvider missing');
      await source.deleteBinding(sessionId);
      await mutate(IM_BINDINGS_KEY);
    },
    [source, mutate],
  );

  const setPreferences = useCallback(
    async (pref: CloudImPreferences) => {
      if (!source) throw new Error('CloudImProvider missing');
      await source.setPreferences(pref);
      await mutate(IM_PREFERENCES_KEY);
    },
    [source, mutate],
  );

  if (!source) return null;
  return {
    linkTelegram,
    unlinkTelegram,
    createBinding,
    setBindingPush,
    deleteBinding,
    setPreferences,
  };
}
