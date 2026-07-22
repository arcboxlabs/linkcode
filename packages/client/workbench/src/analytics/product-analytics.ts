import { zodPersist } from '@linkcode/common/zustand';
import type { AgentKind } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import type { PostHog } from 'posthog-js/dist/module.slim.no-external';
import { z } from 'zod';
import { create } from 'zustand';

interface ProductAnalyticsEvents {
  'app opened': Record<string, never>;
  'host connection failed': { attempt: number; duration_ms: number };
  'host connection ready': { attempt: number; duration_ms: number; recovered: boolean };
  'thread create failed': { agent_kind: AgentKind; duration_ms: number };
  'thread created': { agent_kind: AgentKind; duration_ms: number };
  'thread closed': Record<string, never>;
  'turn cancelled': Record<string, never>;
  'turn submitted': { input_kind: 'command' | 'prompt' | 'shell-command' };
}

export interface ProductAnalyticsConfig {
  projectToken?: string;
  host?: string;
  surface: 'desktop' | 'webview';
  platform: string;
}

interface ResolvedProductAnalyticsConfig extends ProductAnalyticsConfig {
  projectToken: string;
  host: string;
}

interface ProductAnalyticsPreferenceState {
  enabled: boolean;
  lastIdentifiedUserId: string | null;
}

const PersistedPreferenceSchema = z
  .object({ enabled: z.boolean(), lastIdentifiedUserId: z.string().nullable() })
  .partial();

export const useProductAnalyticsPreference = create<ProductAnalyticsPreferenceState>()(
  zodPersist<ProductAnalyticsPreferenceState>(
    (_set) => ({ enabled: false, lastIdentifiedUserId: null }),
    {
      name: 'linkcode.analytics.preference:v1',
      schema: PersistedPreferenceSchema,
      partialize: (state) => ({
        enabled: state.enabled,
        lastIdentifiedUserId: state.lastIdentifiedUserId,
      }),
    },
  ),
);

const EVENT_PROPERTIES = new Map<string, ReadonlySet<string>>([
  ['$identify', new Set()],
  ['app opened', new Set()],
  ['host connection failed', new Set(['attempt', 'duration_ms'])],
  ['host connection ready', new Set(['attempt', 'duration_ms', 'recovered'])],
  ['thread create failed', new Set(['agent_kind', 'duration_ms'])],
  ['thread created', new Set(['agent_kind', 'duration_ms'])],
  ['thread closed', new Set()],
  ['turn cancelled', new Set()],
  ['turn submitted', new Set(['input_kind'])],
]);
const COMMON_PROPERTIES = new Set<string>([
  '$anon_distinct_id',
  '$lib',
  '$lib_version',
  '$process_person_profile',
  'distinct_id',
  'platform',
  'surface',
  'token',
]);

let config: ResolvedProductAnalyticsConfig | null = null;
let posthogClient: PostHog | null = null;
let posthogClientPromise: Promise<PostHog> | null = null;
let sdkInitialized = false;
let analyticsActive = false;
let identityResolved = false;
let currentUserId: string | null = null;
let identityGeneration = 0;
let appOpenedCaptured = false;
let commonProperties: { surface: ProductAnalyticsConfig['surface']; platform: string } | null =
  null;

/** Initializes the browser SDK only when both public build-time values are configured. */
export function initializeProductAnalytics(nextConfig: ProductAnalyticsConfig): void {
  if (
    config !== null ||
    !nextConfig.projectToken ||
    !nextConfig.host ||
    (nextConfig.surface === 'desktop' && !isPostHogCloudHost(nextConfig.host))
  ) {
    return;
  }
  config = {
    ...nextConfig,
    projectToken: nextConfig.projectToken,
    host: nextConfig.host,
  };
  commonProperties = { surface: nextConfig.surface, platform: nextConfig.platform };
  applyPreference(useProductAnalyticsPreference.getState().enabled);
}

export function setProductAnalyticsEnabled(enabled: boolean): void {
  useProductAnalyticsPreference.setState({ enabled });
  applyPreference(enabled);
}

/** Keeps anonymous activity separate across account switches and links it only after consent. */
export function syncProductAnalyticsIdentity(userId: string | null): void {
  analyticsActive = false;
  identityGeneration += 1;
  identityResolved = true;
  currentUserId = userId;
  if (config === null || !useProductAnalyticsPreference.getState().enabled) return;
  void activateProductAnalytics().catch(noop);
}

export function captureProductEvent<Event extends keyof ProductAnalyticsEvents>(
  event: Event,
  properties: ProductAnalyticsEvents[Event],
): void {
  if (
    !analyticsActive ||
    !sdkInitialized ||
    posthogClient === null ||
    !identityResolved ||
    !useProductAnalyticsPreference.getState().enabled
  ) {
    return;
  }
  posthogClient.capture(event, properties);
}

function applyPreference(enabled: boolean): void {
  if (config === null) return;
  if (!enabled) {
    analyticsActive = false;
    if (sdkInitialized && posthogClient !== null) {
      posthogClient.reset();
      posthogClient.opt_out_capturing();
    }
    return;
  }
  if (!identityResolved) return;

  void activateProductAnalytics().catch(noop);
}

async function activateProductAnalytics(): Promise<void> {
  const preference = useProductAnalyticsPreference.getState();
  if (!identityResolved || config === null || commonProperties === null || !preference.enabled) {
    return;
  }
  const activatingIdentityGeneration = identityGeneration;
  const activatingUserId = currentUserId;

  const client = await loadPostHogClient();
  if (
    activatingIdentityGeneration !== identityGeneration ||
    activatingUserId !== currentUserId ||
    !useProductAnalyticsPreference.getState().enabled
  ) {
    return;
  }

  if (!sdkInitialized) {
    client.init(config.projectToken, {
      api_host: config.host,
      defaults: '2026-05-30',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      person_profiles: 'identified_only',
      persistence: 'localStorage',
      opt_out_capturing_by_default: true,
      opt_out_persistence_by_default: true,
      before_send: sanitizeProductAnalyticsEvent,
    });
    sdkInitialized = true;
  }

  if (
    preference.lastIdentifiedUserId !== null &&
    preference.lastIdentifiedUserId !== activatingUserId
  ) {
    client.reset();
  }
  client.opt_in_capturing({ captureEventName: false });
  client.register(commonProperties);
  if (activatingUserId !== null) client.identify(activatingUserId);
  useProductAnalyticsPreference.setState({ lastIdentifiedUserId: activatingUserId });
  analyticsActive = true;
  if (!appOpenedCaptured) {
    appOpenedCaptured = true;
    captureProductEvent('app opened', {});
  }
}

function loadPostHogClient(): Promise<PostHog> {
  posthogClientPromise ??= import('posthog-js/dist/module.slim.no-external').then((module) => {
    posthogClient = module.default;
    return posthogClient;
  });
  return posthogClientPromise;
}

/** Drops implicit events and retains only the explicitly approved event properties. */
export function sanitizeProductAnalyticsEvent<
  T extends {
    event?: string;
    properties?: Record<string, unknown>;
    $set?: Record<string, unknown>;
    $set_once?: Record<string, unknown>;
  },
>(event: T | null): T | null {
  if (!event?.event) return null;
  const eventProperties = EVENT_PROPERTIES.get(event.event);
  if (!eventProperties) return null;

  const properties = Object.fromEntries(
    Object.entries(event.properties ?? {}).filter(
      ([key]) => COMMON_PROPERTIES.has(key) || eventProperties.has(key),
    ),
  );

  return { ...event, properties, $set: undefined, $set_once: undefined };
}

function isPostHogCloudHost(host: string): boolean {
  try {
    const url = new URL(host);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'posthog.com' || url.hostname.endsWith('.posthog.com'))
    );
  } catch {
    return false;
  }
}
