import type { AgentKind } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import PostHog, { PostHogPersistedProperty } from 'posthog-react-native';
import { Platform } from 'react-native';
import { useAnalyticsPreferenceStore } from '../stores/analytics-store';

interface MobileProductAnalyticsEvents {
  'app opened': Record<string, never>;
  'host connection failed': { duration_ms: number };
  'host connection ready': { duration_ms: number };
  'thread create failed': { agent_kind: AgentKind; duration_ms: number };
  'thread created': { agent_kind: AgentKind; duration_ms: number };
}

const projectToken = process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST;
const configured = !__DEV__ && Boolean(projectToken) && Boolean(host);
const EVENT_PROPERTIES = new Map<string, ReadonlySet<string>>([
  ['$identify', new Set()],
  ['app opened', new Set()],
  ['host connection failed', new Set(['duration_ms'])],
  ['host connection ready', new Set(['duration_ms'])],
  ['thread create failed', new Set(['agent_kind', 'duration_ms'])],
  ['thread created', new Set(['agent_kind', 'duration_ms'])],
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

let mobileProductAnalytics: PostHog | null = null;
let activeMobileProductAnalytics: PostHog | null = null;
let identityResolved = false;
let currentUserId: string | null = null;
let identityGeneration = 0;
let appOpenedCaptured = false;
let operation = Promise.resolve();
let consentGeneration = 0;

export function setMobileProductAnalyticsEnabled(enabled: boolean): void {
  useAnalyticsPreferenceStore.setState({ enabled });
  applyMobileProductAnalyticsPreference(enabled);
}

export function applyMobileProductAnalyticsPreference(enabled: boolean): void {
  const generation = ++consentGeneration;
  if (!enabled) disableMobileProductAnalytics();

  enqueue(async () => {
    if (!enabled) {
      if (mobileProductAnalytics !== null) {
        await mobileProductAnalytics.ready();
        if (generation === consentGeneration) disableMobileProductAnalytics();
      }
      return;
    }
    await activateMobileProductAnalytics();
  });
}

export function syncMobileProductAnalyticsIdentity(userId: string | null): void {
  activeMobileProductAnalytics = null;
  identityGeneration += 1;
  identityResolved = true;
  currentUserId = userId;
  if (!configured || !useAnalyticsPreferenceStore.getState().enabled) return;

  enqueue(async () => {
    await activateMobileProductAnalytics();
  });
}

export function captureMobileProductEvent<Event extends keyof MobileProductAnalyticsEvents>(
  event: Event,
  properties: MobileProductAnalyticsEvents[Event],
): void {
  if (
    !configured ||
    activeMobileProductAnalytics === null ||
    !identityResolved ||
    !useAnalyticsPreferenceStore.getState().enabled
  ) {
    return;
  }
  try {
    activeMobileProductAnalytics.capture(event, properties);
  } catch {
    // Analytics is best-effort and must never alter the surrounding application flow.
  }
}

function enqueue(task: () => Promise<void>): void {
  operation = operation.then(task).catch(noop);
}

async function activateMobileProductAnalytics(): Promise<void> {
  const activatingConsentGeneration = consentGeneration;
  const activatingIdentityGeneration = identityGeneration;
  const activatingUserId = currentUserId;
  const preference = useAnalyticsPreferenceStore.getState();
  if (
    !identityResolved ||
    !configured ||
    !useAnalyticsPreferenceStore.persist.hasHydrated() ||
    !preference.enabled
  ) {
    return;
  }

  const client = getMobileProductAnalytics();
  await client.ready();
  if (
    !isMobileAnalyticsActivationCurrent(
      activatingConsentGeneration,
      activatingIdentityGeneration,
      activatingUserId,
    )
  ) {
    return;
  }
  if (
    preference.lastIdentifiedUserId !== null &&
    preference.lastIdentifiedUserId !== activatingUserId
  ) {
    client.reset();
  }
  await client.optIn();
  if (
    !isMobileAnalyticsActivationCurrent(
      activatingConsentGeneration,
      activatingIdentityGeneration,
      activatingUserId,
    )
  ) {
    return;
  }
  await client.register({ platform: Platform.OS, surface: 'mobile' });
  if (
    !isMobileAnalyticsActivationCurrent(
      activatingConsentGeneration,
      activatingIdentityGeneration,
      activatingUserId,
    )
  ) {
    return;
  }
  if (activatingUserId !== null) client.identify(activatingUserId);
  useAnalyticsPreferenceStore.setState({ lastIdentifiedUserId: activatingUserId });
  activeMobileProductAnalytics = client;
  if (!appOpenedCaptured) {
    appOpenedCaptured = true;
    captureMobileProductEvent('app opened', {});
  }
}

function isMobileAnalyticsActivationCurrent(
  activatingConsentGeneration: number,
  activatingIdentityGeneration: number,
  activatingUserId: string | null,
): boolean {
  return (
    activatingConsentGeneration === consentGeneration &&
    activatingIdentityGeneration === identityGeneration &&
    activatingUserId === currentUserId &&
    useAnalyticsPreferenceStore.persist.hasHydrated() &&
    useAnalyticsPreferenceStore.getState().enabled
  );
}

function disableMobileProductAnalytics(): void {
  activeMobileProductAnalytics = null;
  if (mobileProductAnalytics === null) return;
  mobileProductAnalytics.setPersistedProperty(PostHogPersistedProperty.Queue, null);
  void mobileProductAnalytics.optOut();
}

function getMobileProductAnalytics(): PostHog {
  if (!projectToken || !host) throw new Error('PostHog is not configured');

  mobileProductAnalytics ??= new PostHog(projectToken, {
    host,
    defaultOptIn: false,
    captureAppLifecycleEvents: false,
    enableSessionReplay: false,
    disableRemoteFeatureFlags: true,
    disableSurveys: true,
    errorTracking: { autocapture: false },
    setDefaultPersonProperties: false,
    personProfiles: 'identified_only',
    before_send: sanitizeMobileProductAnalyticsEvent,
  });
  return mobileProductAnalytics;
}

export function sanitizeMobileProductAnalyticsEvent<
  T extends {
    event: string;
    properties?: Record<string, unknown>;
    $set?: Record<string, unknown>;
    $set_once?: Record<string, unknown>;
  },
>(event: T | null): T | null {
  if (event === null) return null;
  const eventProperties = EVENT_PROPERTIES.get(event.event);
  if (!eventProperties) return null;

  const properties = Object.fromEntries(
    Object.entries(event.properties ?? {}).filter(
      ([key]) => COMMON_PROPERTIES.has(key) || eventProperties.has(key),
    ),
  );

  return { ...event, properties, $set: undefined, $set_once: undefined };
}
