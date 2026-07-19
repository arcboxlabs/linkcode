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

/** Expected link failures are data, not exceptions: `not-found` = wrong/expired code, `conflict`
 * = the Telegram identity is already linked to another LinkCode user. */
export type CloudImLinkResult = { ok: true } | { ok: false; reason: 'not-found' | 'conflict' };

/**
 * IM Channel management calls against the cloud API. Injected by the app because the credential
 * lives outside the data plane (desktop: keychain session in main, exposed over a bridge).
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

/*
 * Every read hook keys its cache by `accountKey` (same reason as `useCloudHosts`): an
 * account-agnostic key plus `keepPreviousData` would serve the previous account's IM data after
 * an account switch. A falsy key means signed out — the endpoint is never hit.
 */

/** Linked IM accounts + registered chats for the signed-in cloud account. */
export function useCloudImOverview(
  accountKey: string | null | undefined,
): SWRResponse<CloudImOverview> {
  const source = use(CloudImSourceContext);
  return useSWR<CloudImOverview>(
    accountKey && source ? [IM_OVERVIEW_KEY, accountKey] : null,
    source ? source.overview : null,
    { revalidateOnFocus: true, keepPreviousData: false },
  );
}

/** Topic↔session bindings on the caller's relay; they change out-of-band (Telegram or the
 * daemon), so revalidate on focus and on a slow interval. */
export function useCloudImBindings(
  accountKey: string | null | undefined,
): SWRResponse<CloudImBinding[]> {
  const source = use(CloudImSourceContext);
  return useSWR<CloudImBinding[]>(
    accountKey && source ? [IM_BINDINGS_KEY, accountKey] : null,
    source ? source.bindings : null,
    { revalidateOnFocus: true, refreshInterval: 30000, keepPreviousData: false },
  );
}

/** Per-account IM preferences (auto-mirror). */
export function useCloudImPreferences(
  accountKey: string | null | undefined,
): SWRResponse<CloudImPreferences> {
  const source = use(CloudImSourceContext);
  return useSWR<CloudImPreferences>(
    accountKey && source ? [IM_PREFERENCES_KEY, accountKey] : null,
    source ? source.preferences : null,
    { revalidateOnFocus: true, keepPreviousData: false },
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

  // Read keys are `[prefix, accountKey]` tuples, so invalidation matches on the prefix.
  const invalidate = useCallback(
    (prefix: string) => mutate((key) => Array.isArray(key) && key[0] === prefix),
    [mutate],
  );

  const linkTelegram = useCallback(
    async (code: string) => {
      if (!source) throw new Error('CloudImProvider missing');
      const result = await source.linkTelegram(code);
      if (result.ok) await invalidate(IM_OVERVIEW_KEY);
      return result;
    },
    [source, invalidate],
  );

  const unlinkTelegram = useCallback(async () => {
    if (!source) throw new Error('CloudImProvider missing');
    await source.unlinkTelegram();
    await Promise.all([
      invalidate(IM_OVERVIEW_KEY),
      invalidate(IM_BINDINGS_KEY),
      invalidate(IM_PREFERENCES_KEY),
    ]);
  }, [source, invalidate]);

  const createBinding = useCallback(
    async (input: CloudImBindingCreate) => {
      if (!source) throw new Error('CloudImProvider missing');
      const result = await source.createBinding(input);
      await invalidate(IM_BINDINGS_KEY);
      return result;
    },
    [source, invalidate],
  );

  const setBindingPush = useCallback(
    async (sessionId: string, pushOut: boolean) => {
      if (!source) throw new Error('CloudImProvider missing');
      await source.updateBinding(sessionId, { pushOut });
      await invalidate(IM_BINDINGS_KEY);
    },
    [source, invalidate],
  );

  const deleteBinding = useCallback(
    async (sessionId: string) => {
      if (!source) throw new Error('CloudImProvider missing');
      await source.deleteBinding(sessionId);
      await invalidate(IM_BINDINGS_KEY);
    },
    [source, invalidate],
  );

  const setPreferences = useCallback(
    async (pref: CloudImPreferences) => {
      if (!source) throw new Error('CloudImProvider missing');
      await source.setPreferences(pref);
      await invalidate(IM_PREFERENCES_KEY);
    },
    [source, invalidate],
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
