import { useLinkCodeClient } from '@linkcode/client-core';
import { enabledAccounts } from '@linkcode/providers';
import type {
  Accounts,
  AgentKind,
  AgentRuntimeAvailability,
  AgentRuntimes,
  ManagedAssetId,
  ManagedAssetKey,
  ManagedAssetStatus,
  ProvidersConfig,
} from '@linkcode/schema';
import { managedAgentAssetId, managedAssetIdEquals, managedAssetKey } from '@linkcode/schema';
import { ensureAsset, getAccounts, getProviderConfig } from '@linkcode/sdk';
import type { AgentRuntimeCue, AgentRuntimeCues } from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { useEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useRef, useState } from 'react';
import { useAssets } from '../assets/hooks';
import { useData, useMutation } from '../runtime/tayori';
import { useAgentRuntimes } from './hooks';
import { useUnverifiedRuntimesStore } from './unverified-store';

/** The managed asset backing each downloadable agent kind; pi's is the in-process npm closure
 * (CODE-219). grok-build has none (detect-only). */
const AGENT_ASSET_IDS: Partial<Record<AgentKind, ManagedAssetId>> = {
  'claude-code': managedAgentAssetId('claude-code'),
  codex: managedAgentAssetId('codex'),
  opencode: managedAgentAssetId('opencode'),
  pi: managedAgentAssetId('pi'),
};

/**
 * Kinds whose login CLI opens the browser ITSELF (CODE-175): claude prints only the manual
 * code-page URL, so opening it too would race the CLI's auto-completing tab with a second
 * paste-code tab. codex is absent — its app-server returns the URL without opening it.
 */
const SELF_OPENING_LOGIN_KINDS: ReadonlySet<AgentKind> = new Set(['claude-code']);

/**
 * Client-local install activity layered over the pulled snapshots (fed by the `asset.progress` /
 * `asset.settled` broadcasts). `installed` bridges the gap between a successful settle and the
 * `agent-runtime.changed` re-probe — probe truth wins (see {@link dropConfirmedInstalls}).
 */
export type AssetActivity =
  | { kind: 'downloading'; receivedBytes: number; totalBytes?: number }
  | { kind: 'failed'; error: string }
  | { kind: 'installed' };

export type AssetActivityMap = Partial<Record<ManagedAssetKey, AssetActivity>>;

/**
 * Drop only the `installed` bridges whose own agent now probes `available`: a push can come from
 * an unrelated kind (reads revalidate, CODE-172), and clearing on any push would flash the
 * Download card back over a just-settled install. Entries with no owning agent drop on any push.
 */
export function dropConfirmedInstalls(
  activity: AssetActivityMap,
  runtimes: AgentRuntimes,
): AssetActivityMap {
  const next: AssetActivityMap = {};
  const assetEntries = Object.entries(AGENT_ASSET_IDS) as Array<[AgentKind, ManagedAssetId]>;
  for (let i = 0, len = assetEntries.length; i < len; i++) {
    const [kind, assetId] = assetEntries[i];
    const key = managedAssetKey(assetId);
    const entry = activity[key];
    if (!entry) continue;
    if (entry.kind !== 'installed') {
      next[key] = entry;
      continue;
    }
    if (runtimes[kind]?.status !== 'available') next[key] = entry;
  }
  return next;
}

/**
 * Client-local progress of an interactive `agent-login`, layered over the probed `loggedIn: false`.
 * Success carries no activity — the `agent-runtime.changed` re-probe flips the probed status.
 */
export type LoginActivity =
  | { kind: 'opening' }
  | { kind: 'awaiting-code'; url?: string }
  | { kind: 'failed'; error: string };

export type LoginActivityMap = Partial<Record<AgentKind, LoginActivity>>;

function versionKey(runtime: AgentRuntimeAvailability): string {
  return runtime.version ?? 'unknown';
}

/**
 * Pure cue derivation for the onboarding UI (CODE-112). A kind absent from `runtimes` is
 * unevaluated and yields no cue; `runtimes` still loading yields no cues at all rather than a
 * flash of "missing".
 */
export function deriveAgentRuntimeCues(
  runtimes: AgentRuntimes | undefined,
  assets: ManagedAssetStatus[] | undefined,
  activity: AssetActivityMap,
  acknowledged: Partial<Record<AgentKind, string>>,
  loginActivity: LoginActivityMap = {},
  providers: ProvidersConfig = {},
  accounts: Accounts = [],
): AgentRuntimeCues {
  const cues: AgentRuntimeCues = {};
  if (!runtimes) return cues;
  const runtimeEntries = Object.entries(runtimes) as Array<[AgentKind, AgentRuntimeAvailability]>;
  for (let i = 0, len = runtimeEntries.length; i < len; i++) {
    const [kind, runtime] = runtimeEntries[i];
    const cue = deriveCue(
      kind,
      runtime,
      assets,
      activity,
      acknowledged,
      loginActivity,
      providers,
      accounts,
    );
    if (cue) cues[kind] = cue;
  }
  return cues;
}

/**
 * Whether LinkCode injects a secret for this agent at spawn, which makes a signed-out CLI runnable
 * (`applyProviderDefaults`): any enabled account's own key/token, or the legacy per-agent api key.
 * An `oauth` account delegates back to the CLI's login store, so it does not count.
 */
export function hasInjectedCredential(
  kind: AgentKind,
  providers: ProvidersConfig,
  accounts: Accounts,
): boolean {
  if (providers[kind]?.apiKey?.trim()) return true;
  return enabledAccounts(accounts, providers, kind).some(
    ({ credential }) => credential.type === 'api-key' || credential.type === 'auth-token',
  );
}

/** The login cue for a signed-out runtime, its phase driven by any in-flight login activity. */
function loginCue(activity: LoginActivity | undefined): AgentRuntimeCue {
  if (activity?.kind === 'opening') return { state: 'needs-login', phase: 'opening' };
  if (activity?.kind === 'awaiting-code') {
    return { state: 'needs-login', phase: 'awaiting-code', url: activity.url };
  }
  if (activity?.kind === 'failed') {
    return { state: 'needs-login', phase: 'failed', error: activity.error };
  }
  return { state: 'needs-login', phase: 'idle' };
}

/**
 * Cue for an in-flight (or just settled) install, overriding the probed status. `installed`
 * clears the cue, bridging to the `agent-runtime.changed` re-probe (probe truth wins).
 */
function activityCue(
  current: AssetActivity | undefined,
): AgentRuntimeCue | 'installed' | undefined {
  if (current?.kind === 'downloading') {
    return {
      state: 'downloading',
      receivedBytes: current.receivedBytes,
      totalBytes: current.totalBytes,
    };
  }
  if (current?.kind === 'failed') return { state: 'failed', error: current.error };
  if (current?.kind === 'installed') return 'installed';
  return undefined;
}

function deriveCue(
  kind: AgentKind,
  runtime: AgentRuntimeAvailability,
  assets: ManagedAssetStatus[] | undefined,
  activity: AssetActivityMap,
  acknowledged: Partial<Record<AgentKind, string>>,
  loginActivity: LoginActivityMap,
  providers: ProvidersConfig,
  accounts: Accounts,
): AgentRuntimeCue | undefined {
  switch (runtime.status) {
    case 'available': {
      const currentLogin = loginActivity[kind];
      if (currentLogin && runtime.auth?.loggedIn !== true) return loginCue(currentLogin);
      // `auth` absent means unprobed or a fail-open probe — don't block. An injected credential
      // makes a signed-out CLI runnable, so it clears the cue (see hasInjectedCredential).
      return runtime.auth?.loggedIn === false && !hasInjectedCredential(kind, providers, accounts)
        ? loginCue(undefined)
        : undefined;
    }
    case 'out-of-range': {
      // "Download paired version" is the same install as the missing flow — activity must win over
      // the probed status here too, or progress never shows and a settled install stays blocked.
      const assetId = AGENT_ASSET_IDS[kind];
      const fromActivity = activityCue(assetId ? activity[managedAssetKey(assetId)] : undefined);
      if (fromActivity === 'installed') return undefined;
      if (fromActivity) return fromActivity;
      return acknowledged[kind] === versionKey(runtime)
        ? undefined
        : { state: 'unverified', version: runtime.version };
    }
    case 'missing': {
      const assetId = AGENT_ASSET_IDS[kind];
      if (!assetId) return { state: 'missing', downloadable: false };
      const fromActivity = activityCue(activity[managedAssetKey(assetId)]);
      if (fromActivity === 'installed') return undefined;
      if (fromActivity) return fromActivity;
      const status = assets?.find((candidate) => managedAssetIdEquals(candidate.id, assetId));
      // Optimistic while `assets` is still loading; a pinless ensure fails into the failed cue.
      return { state: 'missing', downloadable: status ? status.wantedVersion !== undefined : true };
    }
    // no default
  }
}

/**
 * The derived cue map plus the onboarding actions, per agent kind. Progress streams in via the
 * asset broadcasts; snapshots revalidate through the push-aware useAssets/useAgentRuntimes.
 */
export interface AgentRuntimeOnboarding {
  cues: AgentRuntimeCues;
  download: (kind: AgentKind) => void;
  acknowledgeUnverified: (kind: AgentKind) => void;
  login: (kind: AgentKind, onSuccess?: () => void) => void;
  submitLoginCode: (kind: AgentKind, code: string) => void;
  cancelLogin: (kind: AgentKind) => void;
}

export function useAgentRuntimeOnboarding(): AgentRuntimeOnboarding {
  const client = useLinkCodeClient();
  const { data: runtimes } = useAgentRuntimes();
  const { data: assets } = useAssets();
  // An injected credential makes a signed-out CLI runnable, so it suppresses the login cue.
  const { data: providers } = useData(getProviderConfig, {});
  const { data: accounts } = useData(getAccounts, {});
  const [activity, setActivity] = useState<AssetActivityMap>({});
  const [loginActivity, setLoginActivity] = useState<LoginActivityMap>({});
  // The in-flight loginId per kind (+ a cancel flag so a user-aborted login settles to idle, not
  // failed). A ref, not state: the settled callback must read the current value, not a stale closure.
  const activeLoginsRef = useRef(new Map<AgentKind, { loginId?: string; cancelled: boolean }>());
  const acknowledged = useUnverifiedRuntimesStore((state) => state.acknowledged);
  const acknowledge = useUnverifiedRuntimesStore((state) => state.acknowledge);
  // Failures surface through the settled broadcast / local catch as the failed cue — no banner.
  const ensureMutation = useMutation(ensureAsset, { onError: noop });

  useEffect(
    (signal) =>
      client.subscribeAssetProgress((event) => {
        if (signal.aborted) return;
        setActivity((previous) => ({
          ...previous,
          [managedAssetKey(event.id)]: {
            kind: 'downloading',
            receivedBytes: event.receivedBytes,
            totalBytes: event.totalBytes,
          },
        }));
      }),
    [client],
  );

  useEffect(
    (signal) =>
      client.subscribeAssetSettled((event) => {
        if (signal.aborted) return;
        setActivity((previous) => ({
          ...previous,
          [managedAssetKey(event.id)]: event.error
            ? { kind: 'failed', error: event.error }
            : { kind: 'installed' },
        }));
      }),
    [client],
  );

  // The re-probe push is the truth an `installed` bridge waits for — drop confirmed entries.
  useEffect(
    (signal) =>
      client.subscribeAgentRuntimesChanged((runtimes) => {
        if (signal.aborted) return;
        setActivity((previous) => dropConfirmedInstalls(previous, runtimes));
      }),
    [client],
  );

  useEffect(
    () => () => {
      for (const entry of activeLoginsRef.current.values()) {
        entry.cancelled = true;
        if (entry.loginId) client.cancelAgentLogin(entry.loginId);
      }
      activeLoginsRef.current.clear();
    },
    [client],
  );

  function download(kind: AgentKind): void {
    const id = AGENT_ASSET_IDS[kind];
    if (!id) return;
    // Instant feedback: the first progress broadcast can trail the click by a network roundtrip.
    const key = managedAssetKey(id);
    setActivity((previous) => ({ ...previous, [key]: { kind: 'downloading', receivedBytes: 0 } }));
    // A daemon-side failure also arrives as `asset.settled`; this catch covers transport errors.
    ensureMutation.trigger({ id }).catch((err: unknown) => {
      setActivity((previous) => ({
        ...previous,
        [key]: { kind: 'failed', error: extractErrorMessage(err) ?? 'download failed' },
      }));
    });
  }

  function acknowledgeUnverified(kind: AgentKind): void {
    const runtime = runtimes?.[kind];
    if (runtime?.status !== 'out-of-range') return;
    acknowledge(kind, versionKey(runtime));
  }

  function setLogin(kind: AgentKind, next: LoginActivity | undefined): void {
    setLoginActivity((previous) => {
      if (!next) {
        const { [kind]: _cleared, ...rest } = previous;
        return rest;
      }
      return { ...previous, [kind]: next };
    });
  }

  function login(kind: AgentKind, onSuccess?: () => void): void {
    const previous = activeLoginsRef.current.get(kind);
    if (previous) {
      previous.cancelled = true;
      if (previous.loginId) client.cancelAgentLogin(previous.loginId);
    }
    const entry = { loginId: undefined as string | undefined, cancelled: false, onSuccess };
    activeLoginsRef.current.set(kind, entry);
    setLogin(kind, { kind: 'opening' });
    client
      .startAgentLogin(kind)
      .then((loginId) => {
        entry.loginId = loginId;
        client.subscribeAgentLogin(loginId, {
          onUrl(url) {
            if (activeLoginsRef.current.get(kind) !== entry || entry.cancelled) return;
            // Desktop routes `_blank` to the system browser; the card keeps `url` as a fallback
            // link. Self-opening CLIs already launched their own tab — don't race it in a second.
            if (!SELF_OPENING_LOGIN_KINDS.has(kind)) {
              window.open(url, '_blank', 'noopener,noreferrer');
            }
            setLogin(kind, { kind: 'awaiting-code', url });
          },
          onSettled({ ok, error }) {
            if (activeLoginsRef.current.get(kind) !== entry) return;
            activeLoginsRef.current.delete(kind);
            // Success: the re-probe push flips the runtime to logged-in and drops the cue. Cancel:
            // back to the idle login button. Failure: show the error with a retry.
            if (entry.cancelled) setLogin(kind, undefined);
            else if (ok) {
              setLogin(kind, undefined);
              entry.onSuccess?.();
            } else setLogin(kind, { kind: 'failed', error: error ?? 'login failed' });
          },
        });
        if (entry.cancelled) client.cancelAgentLogin(loginId);
      })
      .catch((err: unknown) => {
        if (activeLoginsRef.current.get(kind) !== entry) return;
        activeLoginsRef.current.delete(kind);
        if (entry.cancelled) setLogin(kind, undefined);
        else setLogin(kind, { kind: 'failed', error: extractErrorMessage(err) ?? 'login failed' });
      });
  }

  function submitLoginCode(kind: AgentKind, code: string): void {
    const loginId = activeLoginsRef.current.get(kind)?.loginId;
    if (loginId) client.submitLoginCode(loginId, code);
  }

  function cancelLogin(kind: AgentKind): void {
    const entry = activeLoginsRef.current.get(kind);
    if (entry) {
      entry.cancelled = true;
      if (entry.loginId) client.cancelAgentLogin(entry.loginId);
    }
    setLogin(kind, undefined);
  }

  return {
    cues: deriveAgentRuntimeCues(
      runtimes,
      assets,
      activity,
      acknowledged,
      loginActivity,
      providers,
      accounts,
    ),
    download,
    acknowledgeUnverified,
    login,
    submitLoginCode,
    cancelLogin,
  };
}
