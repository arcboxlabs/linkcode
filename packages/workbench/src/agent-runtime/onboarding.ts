import { useLinkCodeClient } from '@linkcode/client-core';
import type {
  AgentKind,
  AgentRuntimeAvailability,
  AgentRuntimes,
  ManagedAssetId,
  ManagedAssetStatus,
} from '@linkcode/schema';
import { ensureAsset } from '@linkcode/sdk';
import type { AgentRuntimeCue, AgentRuntimeCues } from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useState } from 'react';
import { useAssets } from '../assets/hooks';
import { useMutation } from '../runtime/tayori';
import { useAgentRuntimes } from './hooks';
import { useUnverifiedRuntimesStore } from './unverified-store';

/** The managed asset backing each downloadable agent kind; pi is builtin and has none. */
const AGENT_ASSET_IDS: Partial<Record<AgentKind, ManagedAssetId>> = {
  'claude-code': 'agent:claude-code',
  codex: 'agent:codex',
  opencode: 'agent:opencode',
};

/**
 * Client-local install activity per asset, layered over the pulled snapshots: `downloading` and
 * `failed` come from the `asset.progress` / `asset.settled` broadcasts, `installed` bridges the
 * gap between a successful settle and the `agent-runtime.changed` re-probe that confirms it
 * (cleared when that push lands, so probe truth always wins).
 */
export type AssetActivity =
  | { kind: 'downloading'; receivedBytes: number; totalBytes?: number }
  | { kind: 'failed'; error: string }
  | { kind: 'installed' };

export type AssetActivityMap = Partial<Record<ManagedAssetId, AssetActivity>>;

function versionKey(runtime: AgentRuntimeAvailability): string {
  return runtime.version ?? 'unknown';
}

/**
 * Pure cue derivation for the onboarding UI (CODE-112). A kind absent from `runtimes` yields no
 * cue (unevaluated — opencode until CODE-76); `runtimes` still loading yields no cues at all
 * rather than a flash of "missing".
 */
export function deriveAgentRuntimeCues(
  runtimes: AgentRuntimes | undefined,
  assets: ManagedAssetStatus[] | undefined,
  activity: AssetActivityMap,
  acknowledged: Partial<Record<AgentKind, string>>,
): AgentRuntimeCues {
  const cues: AgentRuntimeCues = {};
  if (!runtimes) return cues;
  for (const [kind, runtime] of Object.entries(runtimes) as Array<
    [AgentKind, AgentRuntimeAvailability]
  >) {
    const cue = deriveCue(kind, runtime, assets, activity, acknowledged);
    if (cue) cues[kind] = cue;
  }
  return cues;
}

/**
 * The cue for an install in flight (or just settled) for this asset, whatever the probed status
 * said: `downloading` shows progress, `failed` offers retry, and `installed` bridges the gap to
 * the `agent-runtime.changed` re-probe by clearing the cue (probe truth wins once it arrives).
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
): AgentRuntimeCue | undefined {
  switch (runtime.status) {
    case 'available':
      return undefined;
    case 'out-of-range': {
      // "Download paired version" runs the same install as the missing flow — its activity must
      // win over the probed status here too, or the card never shows progress and a settled
      // install stays blocked until the re-probe push lands.
      const assetId = AGENT_ASSET_IDS[kind];
      const fromActivity = activityCue(assetId ? activity[assetId] : undefined);
      if (fromActivity === 'installed') return undefined;
      if (fromActivity) return fromActivity;
      return acknowledged[kind] === versionKey(runtime)
        ? undefined
        : { state: 'unverified', version: runtime.version };
    }
    case 'missing': {
      const assetId = AGENT_ASSET_IDS[kind];
      if (!assetId) return { state: 'missing', downloadable: false };
      const fromActivity = activityCue(activity[assetId]);
      if (fromActivity === 'installed') return undefined;
      if (fromActivity) return fromActivity;
      const status = assets?.find((candidate) => candidate.id === assetId);
      // Optimistic while `assets` is still loading; a pinless ensure fails into the failed cue.
      return { state: 'missing', downloadable: status ? status.wantedVersion !== undefined : true };
    }
    // no default
  }
}

/**
 * Everything the onboarding UI needs, per agent kind: the derived cue map plus the download and
 * "continue with unverified version" actions. Progress and terminal state stream in via the
 * asset broadcasts; snapshots revalidate through the push-aware useAssets/useAgentRuntimes.
 */
export function useAgentRuntimeOnboarding(): {
  cues: AgentRuntimeCues;
  download: (kind: AgentKind) => void;
  acknowledgeUnverified: (kind: AgentKind) => void;
} {
  const client = useLinkCodeClient();
  const { data: runtimes } = useAgentRuntimes();
  const { data: assets } = useAssets();
  const [activity, setActivity] = useState<AssetActivityMap>({});
  const acknowledged = useUnverifiedRuntimesStore((state) => state.acknowledged);
  const acknowledge = useUnverifiedRuntimesStore((state) => state.acknowledge);
  // Failures surface through the settled broadcast / local catch as the failed cue — no banner.
  const ensureMutation = useMutation(ensureAsset, { onError: noop });

  useAbortableEffect(
    (signal) =>
      client.subscribeAssetProgress((event) => {
        if (signal.aborted) return;
        setActivity((previous) => ({
          ...previous,
          [event.id]: {
            kind: 'downloading',
            receivedBytes: event.receivedBytes,
            totalBytes: event.totalBytes,
          },
        }));
      }),
    [client],
  );

  useAbortableEffect(
    (signal) =>
      client.subscribeAssetSettled((event) => {
        if (signal.aborted) return;
        setActivity((previous) => ({
          ...previous,
          [event.id]: event.error ? { kind: 'failed', error: event.error } : { kind: 'installed' },
        }));
      }),
    [client],
  );

  // The re-probe push is the truth an `installed` bridge waits for — drop the bridge entries.
  useAbortableEffect(
    (signal) =>
      client.subscribeAgentRuntimesChanged(() => {
        if (signal.aborted) return;
        setActivity((previous) => {
          const next: AssetActivityMap = {};
          for (const [id, entry] of Object.entries(previous) as Array<
            [ManagedAssetId, AssetActivity]
          >) {
            if (entry.kind !== 'installed') next[id] = entry;
          }
          return next;
        });
      }),
    [client],
  );

  function download(kind: AgentKind): void {
    const id = AGENT_ASSET_IDS[kind];
    if (!id) return;
    // Instant feedback: the first progress broadcast can trail the click by a network roundtrip.
    setActivity((previous) => ({ ...previous, [id]: { kind: 'downloading', receivedBytes: 0 } }));
    // A daemon-side failure also arrives as `asset.settled`; this catch covers transport errors.
    ensureMutation.trigger({ id }).catch((err: unknown) => {
      setActivity((previous) => ({
        ...previous,
        [id]: { kind: 'failed', error: extractErrorMessage(err) ?? 'download failed' },
      }));
    });
  }

  function acknowledgeUnverified(kind: AgentKind): void {
    const runtime = runtimes?.[kind];
    if (runtime?.status !== 'out-of-range') return;
    acknowledge(kind, versionKey(runtime));
  }

  return {
    cues: deriveAgentRuntimeCues(runtimes, assets, activity, acknowledged),
    download,
    acknowledgeUnverified,
  };
}
