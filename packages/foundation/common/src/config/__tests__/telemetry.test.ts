import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type {
  ConfigTelemetryReporterOptions,
  ConfigTelemetryRequest,
  ConfigTelemetrySendOutcome,
} from '../telemetry';
import {
  ConfigTelemetryReporter,
  configTelemetryEventsUrl,
  configTelemetryFailureType,
  configTelemetryOutcomeForStatus,
} from '../telemetry';
import type {
  ConfigErrorCode,
  ConfigErrorEvent,
  ConfigPublicationIdentity,
  ConfigStorage,
  ConfigTarget,
} from '../types';
import { ConfigCoreError } from '../types';

const FIXTURE_BYTES = readFileSync(
  new URL('../__fixtures__/config-telemetry-v1.json', import.meta.url),
);

interface TelemetryFixture {
  readonly request: ConfigTelemetryRequest;
  readonly rejections: Readonly<Record<string, number>>;
  readonly response: {
    readonly firstSubmission: { readonly httpStatus: number };
    readonly exactReplay: { readonly httpStatus: number };
  };
}

const FIXTURE = JSON.parse(FIXTURE_BYTES.toString('utf8')) as TelemetryFixture;

const PUBLICATION: ConfigPublicationIdentity = {
  activationVersion: '100',
  configVersion: '2026.08.03-041',
  sha256: 'f3482464e099c416e92feb19f9492458d0c1c9de8f74c89ca5d2d4a4d47600b9',
};
const TARGET: ConfigTarget = { brandId: 'acme', channel: 'canary', platform: 'desktop' };
const T0 = Date.parse('2026-08-03T16:00:00.000Z');

class MemoryStorage implements ConfigStorage {
  readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

describe('frozen cloud fixture', () => {
  it('is the exact fixture published by the cloud half', () => {
    expect(FIXTURE_BYTES.byteLength).toBe(2969);
    expect(createHash('sha256').update(FIXTURE_BYTES).digest('hex')).toBe(
      '385076f295b22dfa4c15bc2c5ae33cf8c3059b9490aecce0622aab55d2681ede',
    );
  });

  it('produces the fixture request verbatim for an activation on the fixture publication', async () => {
    const sent: ConfigTelemetryRequest[] = [];
    const reporter = makeReporter({
      appVersion: FIXTURE.request.appVersion,
      now: () => Date.parse(FIXTURE.request.eventTime),
      randomUuid: () => FIXTURE.request.clientEventId,
      send(request) {
        sent.push(request);
        return Promise.resolve('accepted');
      },
      target: {
        brandId: FIXTURE.request.target.brand,
        channel: FIXTURE.request.rollout.channel,
        platform: FIXTURE.request.target.platform,
      },
    });
    reporter.record({ type: 'activation', publication: FIXTURE.request.publication });
    await reporter.flush();
    expect(sent).toHaveLength(1);
    // Strict deep equality both ways: no unknown fields can ship, none may be missing.
    expect(JSON.parse(JSON.stringify(sent[0]))).toStrictEqual(FIXTURE.request);
  });

  it('documents the response and rejection statuses this client maps', () => {
    expect(FIXTURE.response.firstSubmission.httpStatus).toBe(202);
    expect(FIXTURE.response.exactReplay.httpStatus).toBe(202);
    expect(FIXTURE.rejections).toStrictEqual({
      unauthenticated: 401,
      consentNotGrantedOrSchemaInvalid: 400,
      eventIdConflictOrPublicationMismatch: 409,
      rateLimited: 429,
    });
  });
});

describe('classification', () => {
  it('maps every core failure code to exactly the accepted wire event types', () => {
    const expected: Record<ConfigErrorCode, ReturnType<typeof configTelemetryFailureType>> = {
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
    for (const [code, failureType] of Object.entries(expected)) {
      expect(configTelemetryFailureType(code as ConfigErrorCode)).toBe(failureType);
    }
  });

  it('maps response statuses onto exact retry semantics', () => {
    expect(configTelemetryOutcomeForStatus(202)).toBe('accepted');
    expect(configTelemetryOutcomeForStatus(400)).toBe('rejected');
    expect(configTelemetryOutcomeForStatus(401)).toBe('unauthenticated');
    expect(configTelemetryOutcomeForStatus(409)).toBe('rejected');
    expect(configTelemetryOutcomeForStatus(429)).toBe('retry');
    expect(configTelemetryOutcomeForStatus(500)).toBe('retry');
    expect(configTelemetryOutcomeForStatus(0)).toBe('retry');
  });

  it('builds the events URL from the bundled telemetry endpoint', () => {
    expect(configTelemetryEventsUrl('https://api.linkcode.ai/system/config-telemetry')).toBe(
      'https://api.linkcode.ai/system/config-telemetry/events',
    );
    expect(configTelemetryEventsUrl('https://telemetry.example.invalid/acme/')).toBe(
      'https://telemetry.example.invalid/acme/events',
    );
  });
});

describe('ConfigTelemetryReporter', () => {
  it('drops failures without verified publication identity and unmapped codes', async () => {
    const { reporter, sent } = makeAccepting();
    reporter.record(errorEvent('fetch'));
    reporter.record({ ...errorEvent('replay'), publication: PUBLICATION });
    reporter.record({ type: 'invalid-runtime-app-version', value: 'x' });
    await reporter.flush();
    expect(sent).toEqual([]);
    await expect(reporter.snapshotQueue()).resolves.toEqual([]);
  });

  it('sends a mapped failure carrying only the verified publication identity', async () => {
    const { reporter, sent } = makeAccepting();
    const error = new ConfigCoreError('hash-mismatch', 'https://cdn.example/x deadbeef stack', {
      cause: new Error('secret-token=abc'),
    });
    reporter.record({
      type: 'error',
      operation: 'normal-refresh',
      error,
      publication: PUBLICATION,
    });
    await reporter.flush();
    expect(sent).toHaveLength(1);
    const body = JSON.stringify(sent[0]);
    expect(sent[0]?.eventType).toBe('snapshot_hash_failure');
    expect(body).not.toContain('cdn.example');
    expect(body).not.toContain('secret-token');
    expect(body).not.toContain('stack');
    expect(Object.keys(sent[0] ?? {}).sort()).toEqual(Object.keys(FIXTURE.request).sort());
  });

  it('never records without currently granted consent, and never retroactively', async () => {
    let consent = false;
    const { reporter, sent } = makeAccepting({ consent: () => consent });
    reporter.record({ type: 'activation', publication: PUBLICATION });
    await reporter.flush();
    consent = true;
    await reporter.flush();
    expect(sent).toEqual([]);
    await expect(reporter.snapshotQueue()).resolves.toEqual([]);
  });

  it('purges the queue instead of sending after consent is revoked', async () => {
    let consent = true;
    const storage = new MemoryStorage();
    const sent: ConfigTelemetryRequest[] = [];
    const reporter = makeReporter({
      consent: () => consent,
      send(request) {
        sent.push(request);
        return Promise.resolve('retry');
      },
      storage,
    });
    reporter.record({ type: 'activation', publication: PUBLICATION });
    await reporter.flush();
    expect(await reporter.snapshotQueue()).toHaveLength(1);
    consent = false;
    await reporter.flush();
    await expect(reporter.snapshotQueue()).resolves.toEqual([]);
    expect(sent.length).toBeLessThanOrEqual(1);
  });

  it('holds the exact body across auth loss and resends it unchanged once authenticated', async () => {
    let authenticated = false;
    let now = T0;
    const attempts: ConfigTelemetryRequest[] = [];
    const reporter = makeReporter({
      initialRetryDelayMs: 1000,
      now: () => now,
      send(request) {
        attempts.push(request);
        return Promise.resolve<ConfigTelemetrySendOutcome>(
          authenticated ? 'accepted' : 'unauthenticated',
        );
      },
    });
    reporter.record({ type: 'activation', publication: PUBLICATION });
    await reporter.flush();
    expect(attempts).toHaveLength(1);
    await expect(reporter.snapshotQueue()).resolves.toHaveLength(1);
    authenticated = true;
    now += 1001;
    await reporter.flush();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toStrictEqual(attempts[0]);
    await expect(reporter.snapshotQueue()).resolves.toEqual([]);
  });

  it('dequeues on 202 duplicate replay and terminal 400/409 rejections without retrying', async () => {
    for (const outcome of ['accepted', 'rejected'] as const) {
      const sent: ConfigTelemetryRequest[] = [];
      const reporter = makeReporter({
        send(request) {
          sent.push(request);
          return Promise.resolve(outcome);
        },
      });
      reporter.record({ type: 'activation', publication: PUBLICATION });
      await reporter.flush();
      await reporter.flush();
      expect(sent).toHaveLength(1);
      await expect(reporter.snapshotQueue()).resolves.toEqual([]);
    }
  });

  it('backs off between rate-limited retries and preserves the frozen clientEventId', async () => {
    let now = T0;
    let uuid = 0;
    const attempts: ConfigTelemetryRequest[] = [];
    let outcome: ConfigTelemetrySendOutcome = 'retry';
    const reporter = makeReporter({
      initialRetryDelayMs: 1000,
      now: () => now,
      randomUuid: () => `00000000-0000-4000-8000-00000000000${uuid++}`,
      send(request) {
        attempts.push(request);
        return Promise.resolve(outcome);
      },
    });
    reporter.record({ type: 'activation', publication: PUBLICATION });
    await reporter.flush();
    await reporter.flush();
    expect(attempts).toHaveLength(1);
    now += 1001;
    await reporter.flush();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toStrictEqual(attempts[0]);
    outcome = 'accepted';
    now += 2001;
    await reporter.flush();
    expect(attempts).toHaveLength(3);
    expect(attempts[2]).toStrictEqual(attempts[0]);
    await expect(reporter.snapshotQueue()).resolves.toEqual([]);
  });

  it('keeps stable event bodies across restart on the same storage', async () => {
    const storage = new MemoryStorage();
    const first = makeReporter({ send: () => Promise.resolve('retry'), storage });
    first.record({ type: 'activation', publication: PUBLICATION });
    await first.flush();
    const queued = await first.snapshotQueue();
    expect(queued).toHaveLength(1);

    const sent: ConfigTelemetryRequest[] = [];
    const restarted = makeReporter({
      send(request) {
        sent.push(request);
        return Promise.resolve('accepted');
      },
      storage,
    });
    await expect(restarted.snapshotQueue()).resolves.toStrictEqual(queued);
    await restarted.flush();
    expect(sent).toStrictEqual([...queued]);
  });

  it('bounds the queue by dropping the oldest events', async () => {
    let uuid = 0;
    const reporter = makeReporter({
      maxQueuedEvents: 2,
      randomUuid: () => `00000000-0000-4000-8000-00000000000${uuid++}`,
      send: () => Promise.resolve('retry'),
    });
    for (let index = 0; index < 3; index++) {
      reporter.record({ type: 'activation', publication: PUBLICATION });
    }
    await reporter.flush();
    const queued = await reporter.snapshotQueue();
    expect(queued.map((event) => event.clientEventId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
  });

  it('expires events older than the retention window without sending them', async () => {
    let now = T0;
    const sent: ConfigTelemetryRequest[] = [];
    const reporter = makeReporter({
      now: () => now,
      send(request) {
        sent.push(request);
        return Promise.resolve('retry');
      },
    });
    reporter.record({ type: 'activation', publication: PUBLICATION });
    await reporter.flush();
    expect(sent).toHaveLength(1);
    now += 25 * 60 * 60 * 1000;
    await reporter.flush();
    expect(sent).toHaveLength(1);
    await expect(reporter.snapshotQueue()).resolves.toEqual([]);
  });

  it('fails closed on malformed persisted state', async () => {
    const storage = new MemoryStorage();
    const probe = makeReporter({ storage });
    storage.values.set(
      'linkcode-config:v1:telemetry:acme:desktop:canary',
      JSON.stringify({ version: 1, events: [{ schemaVersion: 1, extra: 'field' }] }),
    );
    await expect(probe.snapshotQueue()).resolves.toEqual([]);
    storage.values.set('linkcode-config:v1:telemetry:acme:desktop:canary', '{not json');
    await expect(probe.snapshotQueue()).resolves.toEqual([]);
  });

  it('rejects persisted requests smuggling unknown fields at any nesting level', async () => {
    const key = 'linkcode-config:v1:telemetry:acme:desktop:canary';
    const valid = {
      schemaVersion: 1,
      clientEventId: '11111111-0000-4000-8000-000000000000',
      eventType: 'activation_success',
      consent: 'granted',
      eventTime: new Date(T0).toISOString(),
      target: { brand: 'acme', platform: 'desktop' },
      publication: PUBLICATION,
      rollout: { channel: 'canary' },
      appVersion: '2.5.0',
    };
    const storage = new MemoryStorage();
    const probe = makeReporter({ storage });
    storage.values.set(key, JSON.stringify({ version: 1, events: [valid] }));
    await expect(probe.snapshotQueue()).resolves.toStrictEqual([valid]);

    const tampered = [
      { ...valid, publishTargetId: 'pt_internal' },
      { ...valid, target: { ...valid.target, deviceId: 'device' } },
      { ...valid, publication: { ...valid.publication, url: 'https://leak.example' } },
      { ...valid, rollout: { channel: 'canary', email: 'user@example.com' } },
      { ...valid, clientEventId: 'not-a-uuid' },
    ];
    for (const event of tampered) {
      storage.values.set(key, JSON.stringify({ version: 1, events: [event] }));
      // eslint-disable-next-line no-await-in-loop -- each corrupted queue is checked in isolation
      await expect(probe.snapshotQueue()).resolves.toEqual([]);
    }
    storage.values.set(key, JSON.stringify({ version: 1, events: [valid, { ...valid }] }));
    await expect(probe.snapshotQueue()).resolves.toEqual([]);
  });

  it('rejects persisted requests smuggling forbidden content through allowed fields', async () => {
    const key = 'linkcode-config:v1:telemetry:acme:desktop:canary';
    const valid = {
      schemaVersion: 1,
      clientEventId: '11111111-0000-4000-8000-000000000000',
      eventType: 'activation_success',
      consent: 'granted',
      eventTime: new Date(T0).toISOString(),
      target: { brand: 'acme', platform: 'desktop' },
      publication: PUBLICATION,
      rollout: { channel: 'canary' },
      appVersion: '2.5.0',
    };
    const tampered = [
      { ...valid, target: { brand: 'https://leak.example/token', platform: 'desktop' } },
      { ...valid, publication: { ...PUBLICATION, sha256: 'https://leak.example/secret' } },
      { ...valid, publication: { ...PUBLICATION, activationVersion: 'v1.2.3' } },
      { ...valid, publication: { ...PUBLICATION, configVersion: 'Error: boom at main.js:1' } },
      { ...valid, appVersion: 'Error: secret token leaked' },
      { ...valid, eventTime: '2026-08-03T16:00:00Z' }, // parseable but not the canonical encoding
      { ...valid, clientEventId: '00000000-0000-0000-0000-000000000000' }, // no version/variant
    ];
    const storage = new MemoryStorage();
    const probe = makeReporter({ storage });
    for (const event of tampered) {
      storage.values.set(key, JSON.stringify({ version: 1, events: [event] }));
      // eslint-disable-next-line no-await-in-loop -- each corrupted queue is checked in isolation
      await expect(probe.snapshotQueue()).resolves.toEqual([]);
    }
  });

  it('drops persisted events stamped implausibly far in the future without sending them', async () => {
    const key = 'linkcode-config:v1:telemetry:acme:desktop:canary';
    const storage = new MemoryStorage();
    const sent: ConfigTelemetryRequest[] = [];
    const reporter = makeReporter({
      send(request) {
        sent.push(request);
        return Promise.resolve('accepted');
      },
      storage,
    });
    const future = {
      schemaVersion: 1,
      clientEventId: '11111111-0000-4000-8000-000000000000',
      eventType: 'activation_success',
      consent: 'granted',
      eventTime: new Date(T0 + 6 * 60 * 1000).toISOString(),
      target: { brand: 'acme', platform: 'desktop' },
      publication: PUBLICATION,
      rollout: { channel: 'canary' },
      appVersion: '2.5.0',
    };
    storage.values.set(key, JSON.stringify({ version: 1, events: [future] }));
    await reporter.flush();
    expect(sent).toEqual([]);
    await expect(reporter.snapshotQueue()).resolves.toEqual([]);
  });

  it('purges a stale persisted queue when told consent is absent at startup', async () => {
    const storage = new MemoryStorage();
    const previous = makeReporter({ send: () => Promise.resolve('retry'), storage });
    previous.record({ type: 'activation', publication: PUBLICATION });
    await previous.flush();
    expect(await previous.snapshotQueue()).toHaveLength(1);

    const sent: ConfigTelemetryRequest[] = [];
    const revoked = makeReporter({
      consent: () => false,
      send(request) {
        sent.push(request);
        return Promise.resolve('accepted');
      },
      storage,
    });
    revoked.syncConsent();
    await revoked.flush();
    expect(sent).toEqual([]);
    await expect(revoked.snapshotQueue()).resolves.toEqual([]);
  });

  it('stops draining and discards when consent is revoked while a send is in flight', async () => {
    // Seed a two-event durable queue so one flush drains both from a single loaded batch.
    const storage = new MemoryStorage();
    let uuid = 0;
    const previous = makeReporter({
      randomUuid: () => `00000000-0000-4000-8000-00000000000${uuid++}`,
      send: () => Promise.resolve('retry'),
      storage,
    });
    previous.record({ type: 'activation', publication: PUBLICATION });
    previous.record({ type: 'activation', publication: PUBLICATION });
    await previous.flush();
    expect(await previous.snapshotQueue()).toHaveLength(2);

    let consent = true;
    let resolveFirst!: (outcome: ConfigTelemetrySendOutcome) => void;
    const sent: ConfigTelemetryRequest[] = [];
    const reporter = makeReporter({
      consent: () => consent,
      send(request) {
        sent.push(request);
        if (sent.length === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve('accepted');
      },
      storage,
    });
    const draining = reporter.flush();
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    consent = false;
    reporter.syncConsent();
    consent = true; // A regrant during the in-flight send must not resurrect the revoked batch.
    resolveFirst('accepted');
    await draining;
    await reporter.flush();
    expect(sent).toHaveLength(1);
    await expect(reporter.snapshotQueue()).resolves.toEqual([]);
  });

  it('discards a flush queued before a revocation even when consent is re-granted', async () => {
    // Seed one durable event, then block storage so the next flush waits in the operation chain.
    const seeded = new MemoryStorage();
    const previous = makeReporter({ send: () => Promise.resolve('retry'), storage: seeded });
    previous.record({ type: 'activation', publication: PUBLICATION });
    await previous.flush();
    expect(await previous.snapshotQueue()).toHaveLength(1);

    let releaseGet!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    let blockFirstGet = true;
    const storage: ConfigStorage = {
      async get(storageKey) {
        if (blockFirstGet) {
          blockFirstGet = false;
          await gate;
        }
        return seeded.get(storageKey);
      },
      set: (storageKey, value) => seeded.set(storageKey, value),
    };

    let consent = true;
    const sent: ConfigTelemetryRequest[] = [];
    const reporter = makeReporter({
      consent: () => consent,
      send(request) {
        sent.push(request);
        return Promise.resolve('accepted');
      },
      storage,
    });
    const occupied = reporter.snapshotQueue(); // holds the chain on the gated storage read
    const stale = reporter.flush(); // epoch captured now, before the revocation lands
    consent = false;
    reporter.syncConsent();
    consent = true; // regrant before the stale flush ever ran must not resurrect the old queue
    reporter.syncConsent();
    releaseGet();
    await occupied;
    await stale;
    await reporter.flush();
    expect(sent).toEqual([]);
    await expect(reporter.snapshotQueue()).resolves.toEqual([]);
  });

  it('schedules its own retry flush after a transient failure', async () => {
    vi.useFakeTimers();
    try {
      let now = T0;
      let outcome: ConfigTelemetrySendOutcome = 'retry';
      const sent: ConfigTelemetryRequest[] = [];
      const reporter = makeReporter({
        initialRetryDelayMs: 1000,
        now: () => now,
        send(request) {
          sent.push(request);
          return Promise.resolve(outcome);
        },
      });
      reporter.record({ type: 'activation', publication: PUBLICATION });
      await reporter.flush();
      expect(sent).toHaveLength(1);

      outcome = 'accepted';
      now += 1001;
      await vi.advanceTimersByTimeAsync(1001);
      expect(sent).toHaveLength(2);
      expect(sent[1]).toStrictEqual(sent[0]);
      await expect(reporter.snapshotQueue()).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows storage and sender faults without rejecting', async () => {
    const storage: ConfigStorage = {
      get: () => Promise.reject(new Error('disk')),
      set: () => Promise.reject(new Error('disk')),
    };
    const reporter = makeReporter({ send: () => Promise.reject(new Error('net')), storage });
    reporter.record({ type: 'activation', publication: PUBLICATION });
    await expect(reporter.flush()).resolves.toBeUndefined();
  });
});

function makeReporter(
  overrides?: Partial<ConfigTelemetryReporterOptions>,
): ConfigTelemetryReporter {
  let uuid = 0;
  return new ConfigTelemetryReporter({
    appVersion: '2.5.0',
    consent: () => true,
    now: () => T0,
    randomUuid: () => `11111111-0000-4000-8000-00000000000${uuid++}`,
    send: () => Promise.resolve('accepted'),
    storage: new MemoryStorage(),
    target: TARGET,
    ...overrides,
  });
}

function makeAccepting(overrides?: Partial<ConfigTelemetryReporterOptions>): {
  reporter: ConfigTelemetryReporter;
  sent: ConfigTelemetryRequest[];
} {
  const sent: ConfigTelemetryRequest[] = [];
  const reporter = makeReporter({
    send(request) {
      sent.push(request);
      return Promise.resolve('accepted');
    },
    ...overrides,
  });
  return { reporter, sent };
}

function errorEvent(code: ConfigErrorCode): ConfigErrorEvent {
  return {
    type: 'error',
    operation: 'normal-refresh',
    error: new ConfigCoreError(code, 'diagnostic'),
  };
}
