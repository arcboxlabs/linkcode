import { noop } from 'foxts/noop';
import { isRecord } from './contract';
import type {
  ConfigChannel,
  ConfigErrorCode,
  ConfigEvent,
  ConfigPlatform,
  ConfigPublicationIdentity,
  ConfigStorage,
  ConfigTarget,
} from './types';
import { CONFIG_CHANNELS, CONFIG_PLATFORMS } from './types';

export const CONFIG_TELEMETRY_SCHEMA_VERSION = 1;

export const CONFIG_TELEMETRY_EVENT_TYPES = [
  'activation_success',
  'fetch_failure',
  'signature_verification_failure',
  'snapshot_hash_failure',
  'parse_failure',
] as const;

export type ConfigTelemetryEventType = (typeof CONFIG_TELEMETRY_EVENT_TYPES)[number];
export type ConfigTelemetryFailureType = Exclude<ConfigTelemetryEventType, 'activation_success'>;

/** Exact wire body for POST {telemetryEndpoint}/events; the server rejects unknown fields. */
export interface ConfigTelemetryRequest {
  readonly schemaVersion: 1;
  readonly clientEventId: string;
  readonly eventType: ConfigTelemetryEventType;
  readonly consent: 'granted';
  readonly eventTime: string;
  readonly target: { readonly brand: string; readonly platform: ConfigPlatform };
  readonly publication: ConfigPublicationIdentity;
  readonly rollout: { readonly channel: ConfigChannel };
  readonly appVersion: string;
}

/** Terminal outcomes dequeue; `retry` and `unauthenticated` hold the exact body for later. */
export type ConfigTelemetrySendOutcome = 'accepted' | 'rejected' | 'retry' | 'unauthenticated';

export function telemetryStorageKey(target: ConfigTarget): string {
  return `linkcode-config:v1:telemetry:${target.brandId}:${target.platform}:${target.channel}`;
}

export function configTelemetryEventsUrl(endpoint: string): string {
  let pathEnd = endpoint.length;
  while (pathEnd > 0 && endpoint[pathEnd - 1] === '/') {
    pathEnd -= 1;
  }
  return `${endpoint.slice(0, pathEnd)}/events`;
}

// Anti-replay rejections and local storage/crypto faults have no accepted wire event type.
const FAILURE_TYPE_BY_CODE: Readonly<Record<ConfigErrorCode, ConfigTelemetryFailureType | null>> = {
  'crypto-unavailable': null,
  equivocation: null,
  fetch: 'fetch_failure',
  'hash-mismatch': 'snapshot_hash_failure',
  'invalid-key-length': 'signature_verification_failure',
  'invalid-signature': 'signature_verification_failure',
  'invalid-signature-length': 'signature_verification_failure',
  malformed: 'parse_failure',
  'malformed-key': 'signature_verification_failure',
  'malformed-signature': 'signature_verification_failure',
  replay: null,
  'schema-invalid': 'parse_failure',
  'size-mismatch': 'snapshot_hash_failure',
  storage: null,
  'target-mismatch': 'parse_failure',
  'unknown-key': 'signature_verification_failure',
  'unsupported-contract': 'parse_failure',
  'unsupported-schema': 'parse_failure',
};

export function configTelemetryFailureType(
  code: ConfigErrorCode,
): ConfigTelemetryFailureType | null {
  return FAILURE_TYPE_BY_CODE[code];
}

export function configTelemetryOutcomeForStatus(status: number): ConfigTelemetrySendOutcome {
  if (status === 202) return 'accepted';
  if (status === 401) return 'unauthenticated';
  if (status === 400 || status === 409) return 'rejected';
  // 429, 5xx, and transport faults replay the identical body later; the server answers
  // an exact replay with 202 duplicate=true, so retrying is always safe.
  return 'retry';
}

export interface ConfigTelemetryReporterOptions {
  readonly appVersion: string;
  /** True only while the user's existing durable consent is currently granted. */
  readonly consent: () => boolean;
  readonly initialRetryDelayMs?: number;
  readonly maxEventAgeMs?: number;
  readonly maxQueuedEvents?: number;
  readonly maxRetryDelayMs?: number;
  readonly now?: () => number;
  readonly randomUuid: () => string;
  readonly send: (request: ConfigTelemetryRequest) => Promise<ConfigTelemetrySendOutcome>;
  readonly storage: ConfigStorage;
  readonly target: ConfigTarget;
}

const DEFAULT_MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
// Events stamped further in the future than plausible clock skew are corrupt; drop them.
const MAX_EVENT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_MAX_QUEUED_EVENTS = 32;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 30 * 1000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30 * 60 * 1000;

/**
 * Consent-gated, durably queued reporter for config telemetry. Every method is total: storage,
 * network, and classification failures are swallowed so telemetry can never disturb the
 * configuration lifecycle. Bodies and clientEventIds are frozen at enqueue and survive restarts.
 */
export class ConfigTelemetryReporter {
  readonly #options: ConfigTelemetryReporterOptions;
  readonly #storageKey: string;
  readonly #maxEventAgeMs: number;
  readonly #maxQueuedEvents: number;
  readonly #initialRetryDelayMs: number;
  readonly #maxRetryDelayMs: number;
  #tail: Promise<void> = Promise.resolve();
  #retryDelayMs: number;
  #nextAttemptAt = 0;
  #consentEpoch = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ConfigTelemetryReporterOptions) {
    this.#options = options;
    this.#storageKey = telemetryStorageKey(options.target);
    this.#maxEventAgeMs = options.maxEventAgeMs ?? DEFAULT_MAX_EVENT_AGE_MS;
    this.#maxQueuedEvents = options.maxQueuedEvents ?? DEFAULT_MAX_QUEUED_EVENTS;
    this.#initialRetryDelayMs = options.initialRetryDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS;
    this.#maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    this.#retryDelayMs = this.#initialRetryDelayMs;
  }

  record(event: ConfigEvent): void {
    const classified = classifyEvent(event);
    if (!classified || !this.#options.consent()) return;
    let request: ConfigTelemetryRequest;
    try {
      request = {
        schemaVersion: CONFIG_TELEMETRY_SCHEMA_VERSION,
        clientEventId: this.#options.randomUuid(),
        eventType: classified.eventType,
        consent: 'granted',
        eventTime: new Date(this.#now()).toISOString(),
        target: {
          brand: this.#options.target.brandId,
          platform: this.#options.target.platform,
        },
        publication: classified.publication,
        rollout: { channel: this.#options.target.channel },
        appVersion: this.#options.appVersion,
      };
    } catch {
      return;
    }
    // Only requests the strict persisted-schema parser accepts may ever reach the queue or wire.
    if (parseTelemetryRequest(request) === null) return;
    void this.#chain(async () => {
      await this.#save(this.#prune([...(await this.#load()), request]));
    });
    void this.flush();
  }

  async flush(): Promise<void> {
    // The epoch is captured before queueing: a revocation that lands while this flush is still
    // waiting behind other storage operations must invalidate it even if consent was re-granted.
    const epoch = this.#consentEpoch;
    await this.#chain(() => this.#flushNow(epoch));
  }

  /**
   * Reconciles the durable queue with the current consent value: revocation purges immediately
   * (even mid-flight, via the epoch) and a grant drains what consent now allows. Platforms call
   * this on every consent notification, including a repeated `false` at startup, so a queue left
   * by a previous run cannot outlive a revocation.
   */
  syncConsent(): void {
    if (this.#options.consent()) {
      void this.flush();
      return;
    }
    this.#consentEpoch += 1;
    this.#clearRetryFlush();
    void this.#chain(() => this.#save([]));
  }

  snapshotQueue(): Promise<readonly ConfigTelemetryRequest[]> {
    return this.#chain(() => this.#load());
  }

  async #flushNow(epoch: number): Promise<void> {
    // A stale epoch means a revocation superseded this flush; the purge that revocation queued
    // right behind it clears the queue, so this attempt must not send anything.
    if (epoch !== this.#consentEpoch) return;
    const loaded = await this.#load();
    if (!this.#options.consent()) {
      // Revoked consent conservatively discards anything still queued.
      if (loaded.length > 0) await this.#save([]);
      return;
    }
    let events = this.#prune(loaded);
    let dirty = events.length !== loaded.length;
    if (this.#now() >= this.#nextAttemptAt) {
      while (events.length > 0) {
        // A revocation while the previous send was in flight must stop the drain, even if
        // consent was re-granted since: the epoch outlives the boolean flip-flop.
        if (epoch !== this.#consentEpoch || !this.#options.consent()) {
          events = [];
          dirty = true;
          break;
        }
        let outcome: ConfigTelemetrySendOutcome;
        try {
          // Events replay oldest-first and strictly serially so a retry preserves ordering.
          // eslint-disable-next-line no-await-in-loop -- the next event is sent only after this one settles
          outcome = await this.#options.send(events[0]);
        } catch {
          outcome = 'retry';
        }
        if (outcome !== 'accepted' && outcome !== 'rejected') {
          this.#nextAttemptAt = this.#now() + this.#retryDelayMs;
          this.#retryDelayMs = Math.min(this.#retryDelayMs * 2, this.#maxRetryDelayMs);
          break;
        }
        events = events.slice(1);
        dirty = true;
        this.#retryDelayMs = this.#initialRetryDelayMs;
        this.#nextAttemptAt = 0;
      }
    }
    if (dirty) await this.#save(events);
    if (events.length > 0) this.#scheduleRetryFlush();
    else this.#clearRetryFlush();
  }

  #scheduleRetryFlush(): void {
    if (this.#retryTimer !== null) return;
    const timer = setTimeout(
      () => {
        this.#retryTimer = null;
        void this.flush();
      },
      Math.max(0, this.#nextAttemptAt - this.#now()),
    );
    this.#retryTimer = timer;
    // Node timers must not hold process shutdown open; browser/RN timers have no unref.
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  }

  #clearRetryFlush(): void {
    if (this.#retryTimer === null) return;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  #prune(events: readonly ConfigTelemetryRequest[]): readonly ConfigTelemetryRequest[] {
    const now = this.#now();
    const cutoff = now - this.#maxEventAgeMs;
    const horizon = now + MAX_EVENT_FUTURE_SKEW_MS;
    const fresh = events.filter((event) => {
      const time = Date.parse(event.eventTime);
      return Number.isFinite(time) && time >= cutoff && time <= horizon;
    });
    return fresh.slice(Math.max(0, fresh.length - this.#maxQueuedEvents));
  }

  async #load(): Promise<readonly ConfigTelemetryRequest[]> {
    try {
      const stored = await this.#options.storage.get(this.#storageKey);
      if (stored === null) return [];
      const parsed: unknown = JSON.parse(stored);
      // Malformed persisted state fails closed to an empty queue instead of replaying it.
      if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.events)) return [];
      const events = parsed.events.map(parseTelemetryRequest);
      if (events.some((event) => event === null)) return [];
      const requests = events as readonly ConfigTelemetryRequest[];
      const ids = new Set(requests.map((event) => event.clientEventId));
      return ids.size === requests.length ? requests : [];
    } catch {
      return [];
    }
  }

  async #save(events: readonly ConfigTelemetryRequest[]): Promise<void> {
    try {
      await this.#options.storage.set(this.#storageKey, JSON.stringify({ version: 1, events }));
    } catch {
      // Telemetry persistence must never disturb configuration behavior.
    }
  }

  #chain<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#tail.then(operation);
    this.#tail = result.then(noop).catch(noop);
    return result;
  }
}

function classifyEvent(
  event: ConfigEvent,
): { eventType: ConfigTelemetryEventType; publication: ConfigPublicationIdentity } | null {
  if (event.type === 'activation') {
    return { eventType: 'activation_success', publication: event.publication };
  }
  // Failures without a verified publication identity cannot be truthfully attributed; drop them.
  if (event.type !== 'error' || !event.publication) return null;
  const eventType = configTelemetryFailureType(event.error.code);
  return eventType ? { eventType, publication: event.publication } : null;
}

const TELEMETRY_EVENT_TYPES: ReadonlySet<unknown> = new Set(CONFIG_TELEMETRY_EVENT_TYPES);
const TELEMETRY_PLATFORMS: ReadonlySet<unknown> = new Set(CONFIG_PLATFORMS);
const TELEMETRY_CHANNELS: ReadonlySet<unknown> = new Set(CONFIG_CHANNELS);

// The contract requires a globally unique RFC 9562 UUID of any version (the cloud fixture is v7).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Mirrors the config contract's brand / SHA-256 / configVersion / uint64 activationVersion rules.
const BRAND_RE = /^[a-z][a-z0-9-]{0,62}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const CONFIG_VERSION_RE = /^[\dA-Z][\w.-]{0,127}$/i;
const ACTIVATION_VERSION_RE = /^(?:0|[1-9]\d*)$/;
const MAX_UINT64_DECIMAL = '18446744073709551615';
// Bounded release-version charset: no whitespace, slashes, or colons, so URLs and free-form
// text can never ride along in appVersion.
const APP_VERSION_RE = /^[\da-z][\da-z.+-]{0,63}$/i;

function isActivationVersion(value: string): boolean {
  return (
    ACTIVATION_VERSION_RE.test(value) &&
    (value.length < MAX_UINT64_DECIMAL.length ||
      (value.length === MAX_UINT64_DECIMAL.length && value <= MAX_UINT64_DECIMAL))
  );
}

function isCanonicalEventTime(value: string): boolean {
  const time = Date.parse(value);
  // Exact `toISOString()` round-trip: millisecond-precision UTC with no alternate encodings.
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => present.includes(key));
}

/**
 * Rebuilds a persisted request from validated primitives, rejecting unknown keys at every level:
 * a tampered or corrupted queue must never smuggle extra fields onto the strict wire schema.
 */
function parseTelemetryRequest(value: unknown): ConfigTelemetryRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'clientEventId',
      'eventType',
      'consent',
      'eventTime',
      'target',
      'publication',
      'rollout',
      'appVersion',
    ]) ||
    value.schemaVersion !== CONFIG_TELEMETRY_SCHEMA_VERSION ||
    typeof value.clientEventId !== 'string' ||
    !UUID_RE.test(value.clientEventId) ||
    !TELEMETRY_EVENT_TYPES.has(value.eventType) ||
    value.consent !== 'granted' ||
    typeof value.eventTime !== 'string' ||
    !isCanonicalEventTime(value.eventTime) ||
    typeof value.appVersion !== 'string' ||
    !APP_VERSION_RE.test(value.appVersion)
  ) {
    return null;
  }
  const { target, publication, rollout } = value;
  if (
    !isRecord(target) ||
    !hasExactKeys(target, ['brand', 'platform']) ||
    typeof target.brand !== 'string' ||
    !BRAND_RE.test(target.brand) ||
    !TELEMETRY_PLATFORMS.has(target.platform) ||
    !isRecord(publication) ||
    !hasExactKeys(publication, ['activationVersion', 'sha256', 'configVersion']) ||
    typeof publication.activationVersion !== 'string' ||
    !isActivationVersion(publication.activationVersion) ||
    typeof publication.sha256 !== 'string' ||
    !SHA256_HEX_RE.test(publication.sha256) ||
    typeof publication.configVersion !== 'string' ||
    !CONFIG_VERSION_RE.test(publication.configVersion) ||
    !isRecord(rollout) ||
    !hasExactKeys(rollout, ['channel']) ||
    !TELEMETRY_CHANNELS.has(rollout.channel)
  ) {
    return null;
  }
  return {
    schemaVersion: CONFIG_TELEMETRY_SCHEMA_VERSION,
    clientEventId: value.clientEventId,
    eventType: value.eventType as ConfigTelemetryEventType,
    consent: 'granted',
    eventTime: value.eventTime,
    target: { brand: target.brand, platform: target.platform as ConfigPlatform },
    publication: {
      activationVersion: publication.activationVersion,
      sha256: publication.sha256,
      configVersion: publication.configVersion,
    },
    rollout: { channel: rollout.channel as ConfigChannel },
    appVersion: value.appVersion,
  };
}
