import { hashes, verify } from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { nullthrow } from 'foxts/guard';
import { describe, expect, it } from 'vitest';
import fixture from '../__fixtures__/contract-v1.json';
import { ConfigCore } from '../core';
import { decodeBase64Url } from '../i-json';
import type {
  ConfigCrypto,
  ConfigDefinitions,
  ConfigEvent,
  ConfigNetwork,
  ConfigNetworkRequest,
  ConfigNetworkResponse,
  ConfigStorage,
  ConfigTarget,
  ConfigValue,
  JsonValue,
} from '../types';

const encoder = new TextEncoder();
const DEVICE_ID = '550e8400-e29b-41d4-a716-446655440000';
const TARGET: ConfigTarget = { brandId: 'acme', channel: 'canary', platform: 'desktop' };
hashes.sha512 = sha512;

const DEFINITIONS = {
  'app.displayName': stringDefinition('Default App'),
  'content.home.banner': objectDefinition({ title: 'Default' }),
  'content.items': arrayDefinition([]),
  'feature.aiAssist': booleanDefinition(true),
  'feature.legacy': booleanDefinition(true),
  'feature.newEditor': booleanDefinition(false),
  'params.upload.maxSizeMb': numberDefinition(10),
  'ui.theme': objectDefinition({ primary: '#000000' }),
  'ui.theme.primary': stringDefinition('default-atomic'),
} satisfies ConfigDefinitions;

const TEST_CRYPTO: ConfigCrypto = {
  randomUuid: () => DEVICE_ID,
  sha256: (bytes) => Promise.resolve(sha256(bytes)),
  verifyEd25519: (publicKey, signature, message) =>
    Promise.resolve(verify(signature, message, publicKey, { zip215: false })),
};

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

class QueueNetwork implements ConfigNetwork {
  readonly requests: Array<{ path: string; request: ConfigNetworkRequest }> = [];
  readonly responses: ConfigNetworkResponse[];
  #nextResponse = 0;

  constructor(responses: ConfigNetworkResponse[] = []) {
    this.responses = [...responses];
  }

  get(path: string, request: ConfigNetworkRequest): Promise<ConfigNetworkResponse> {
    this.requests.push({ path, request });
    const response = nullthrow(
      this.responses[this.#nextResponse],
      `No queued response for ${path}`,
    );
    this.#nextResponse += 1;
    return Promise.resolve(response);
  }
}

describe('ConfigCore normal state machine', () => {
  it('starts from typed defaults without network access', async () => {
    const setup = makeSetup();
    const state = await setup.core.initialize();
    expect(state.source).toBe('defaults');
    expect(state.configVersion).toBeNull();
    expect(setup.core.get('feature.aiAssist')).toBe(true);
    expect(setup.core.get('params.upload.maxSizeMb')).toBe(10);
    expect(setup.normal.requests).toEqual([]);
  });

  it('fetches with ETags, applies hot keys, stages cold keys, and boots the LKG cold', async () => {
    const storage = new MemoryStorage();
    const setup = makeSetup({
      storage,
      normalResponses: [
        ok(pointerBytes('normal'), '"p100"'),
        ok(snapshotBytes('current')),
        { status: 304 },
      ],
    });
    const updates: unknown[] = [];
    setup.core.subscribe((state) => updates.push(state));

    await setup.core.initialize();
    await expect(setup.core.refresh()).resolves.toEqual({ status: 'updated' });
    expect(setup.core.get('content.home.banner')).toEqual({
      title: '你好',
      url: 'https://linkcode.ai/docs',
    });
    expect(setup.core.get('app.displayName')).toBe('Default App');
    expect(setup.core.get('feature.legacy')).toBe(true);
    expect(setup.core.get('feature.newEditor')).toBe(false);
    expect(setup.core.get('params.upload.maxSizeMb')).toBe(10);
    expect(setup.core.getState().stagedColdKeys).toEqual([
      'app.displayName',
      'feature.legacy',
      'feature.newEditor',
      'params.upload.maxSizeMb',
    ]);
    expect(updates).toHaveLength(1);

    await expect(setup.core.refresh()).resolves.toEqual({ status: 'not-modified' });
    expect(setup.normal.requests[2]?.request).toEqual({ etag: '"p100"' });

    const restarted = makeSetup({ storage });
    const restartedState = await restarted.core.initialize();
    expect(restartedState.source).toBe('lkg');
    expect(restarted.core.get('app.displayName')).toBe('Acme Studio');
    expect(restarted.core.get('feature.legacy')).toBe(false);
    expect(restarted.core.get('feature.newEditor')).toBe(true);
    expect(restarted.core.get('params.upload.maxSizeMb')).toBe(100);
  });

  it('commits high-water before fetch failure and finishes an idempotent 304 retry', async () => {
    const setup = makeSetup({
      normalResponses: [
        ok(pointerBytes('normal'), '"p100"'),
        { status: 503 },
        { status: 304 },
        ok(snapshotBytes('current')),
        ok(pointerBytes('normal'), '"p100b"'),
      ],
    });
    await setup.core.initialize();
    await expectError(setup.core.refresh(), 'fetch');
    expect(setup.core.getState().source).toBe('defaults');

    await expect(setup.core.refresh()).resolves.toEqual({ status: 'updated' });
    expect(setup.normal.requests[2]?.request).toEqual({ etag: '"p100"' });
    await expect(setup.core.refresh()).resolves.toEqual({ status: 'idempotent' });
    expect(setup.normal.requests).toHaveLength(5);
  });

  it('rejects a pointer 304 when no trusted pointer exists', async () => {
    const setup = makeSetup({ normalResponses: [{ status: 304 }] });
    await setup.core.initialize();
    await expectError(setup.core.refresh(), 'fetch');
  });

  it.each([
    ['malformed', encoder.encode('{'), 'malformed'],
    ['unknown key', pointerBytes('unknownKey'), 'unknown-key'],
    ['invalid signature', pointerBytes('tampered'), 'invalid-signature'],
    ['unsupported contract', pointerBytes('unsupportedContract'), 'unsupported-contract'],
  ] as const)('rejects %s without downloading a snapshot', async (_name, body, code) => {
    const setup = makeSetup({ normalResponses: [ok(body)] });
    await setup.core.initialize();
    await expectError(setup.core.refresh(), code);
    expect(setup.normal.requests).toHaveLength(1);
    expect(setup.core.getState().source).toBe('defaults');
  });

  it('distinguishes malformed signatures and valid cross-target replay', async () => {
    const malformed = structuredClone(fixture.pointers.normal.document);
    malformed.sig = 'not+padded=';
    const malformedSetup = makeSetup({ normalResponses: [ok(documentBytes(malformed))] });
    await malformedSetup.core.initialize();
    await expectError(malformedSetup.core.refresh(), 'malformed-signature');

    const crossTarget = makeSetup({
      normalResponses: [ok(pointerBytes('normal'))],
      target: { ...TARGET, channel: 'stable' },
    });
    await crossTarget.core.initialize();
    await expectError(crossTarget.core.refresh(), 'target-mismatch');
  });

  it('rejects lower replay and equal-version equivocation', async () => {
    const setup = makeSetup({
      normalResponses: [
        ok(pointerBytes('rollback')),
        ok(snapshotBytes('previous')),
        ok(pointerBytes('normal')),
        ok(pointerBytes('rotationWithoutBump')),
      ],
    });
    await setup.core.initialize();
    await expect(setup.core.refresh()).resolves.toEqual({ status: 'updated' });
    await expectError(setup.core.refresh(), 'replay');
    await expectError(setup.core.refresh(), 'equivocation');
  });

  it('rejects size and exact raw-byte hash mismatches after advancing high-water', async () => {
    const short = snapshotBytes('current').slice(0, -1);
    const sizeSetup = makeSetup({
      normalResponses: [ok(pointerBytes('normal')), ok(short)],
    });
    await sizeSetup.core.initialize();
    await expectError(sizeSetup.core.refresh(), 'size-mismatch');

    const changed = snapshotBytes('current');
    changed[changed.length - 2] ^= 1;
    const hashSetup = makeSetup({
      normalResponses: [ok(pointerBytes('normal')), ok(changed)],
    });
    await hashSetup.core.initialize();
    await expectError(hashSetup.core.refresh(), 'hash-mismatch');
  });

  it('retains a trusted unsupported-schema high-water and rejects lower retries', async () => {
    const setup = makeSetup({
      normalResponses: [ok(pointerBytes('schemaTooNew')), ok(pointerBytes('rotation'))],
    });
    await setup.core.initialize();
    await expectError(setup.core.refresh(), 'unsupported-schema');
    expect(setup.normal.requests).toHaveLength(1);
    await expectError(setup.core.refresh(), 'replay');
  });

  it('rejects a known product-schema mismatch without replacing defaults', async () => {
    const definitions = {
      ...DEFINITIONS,
      'params.upload.maxSizeMb': stringDefinition('10'),
    } satisfies ConfigDefinitions;
    const setup = makeSetup({ definitions, normalResponses: normalPublication() });
    await setup.core.initialize();
    await expectError(setup.core.refresh(), 'schema-invalid');
    expect(setup.core.get('params.upload.maxSizeMb')).toBe('10');
  });

  it('drops a corrupted LKG but retains the trusted pointer for a 304 repair', async () => {
    const storage = new MemoryStorage();
    const initial = makeSetup({ storage, normalResponses: normalPublication() });
    await initial.core.initialize();
    await initial.core.refresh();
    const key = 'linkcode-config:v1:normal:acme:desktop:canary';
    const stored = JSON.parse(storage.values.get(key) ?? '{}') as {
      lkg: { snapshot: string };
    };
    stored.lkg.snapshot = 'bad';
    storage.values.set(key, JSON.stringify(stored));

    const events: ConfigEvent[] = [];
    const repaired = makeSetup({
      events,
      storage,
      normalResponses: [{ status: 304 }, ok(snapshotBytes('current'))],
    });
    const state = await repaired.core.initialize();
    expect(state.source).toBe('defaults');
    expect(events.some((event) => event.type === 'error' && event.error.code === 'storage')).toBe(
      true,
    );
    await expect(repaired.core.refresh()).resolves.toEqual({ status: 'updated' });
  });

  it('retains normal replay high-water when a rotated-out key invalidates cached bytes', async () => {
    const storage = new MemoryStorage();
    const initial = makeSetup({
      normalResponses: [ok(pointerBytes('rollback')), ok(snapshotBytes('previous'))],
      storage,
    });
    await initial.core.initialize();
    await initial.core.refresh();

    const currentKeyring = {
      'normal-rfc8032-3': fixture.keys.normal['normal-rfc8032-3'],
    };
    const restarted = makeSetup({
      normalKeyring: currentKeyring,
      normalResponses: [ok(pointerBytes('rotationWithoutBump'))],
      storage,
    });
    expect((await restarted.core.initialize()).source).toBe('defaults');
    await expectError(restarted.core.refresh(), 'equivocation');
    const stored = JSON.parse(
      storage.values.get('linkcode-config:v1:normal:acme:desktop:canary') ?? '{}',
    ) as { highWater?: { version?: string } };
    expect(stored.highWater?.version).toBe('101');
  });
});

describe('ConfigCore telemetry events', () => {
  const NORMAL_PUBLICATION = {
    activationVersion: fixture.pointers.normal.document.activationVersion,
    configVersion: fixture.pointers.normal.document.configVersion,
    sha256: fixture.pointers.normal.document.sha256,
  };

  it('emits one activation with the verified identity per accepted publication', async () => {
    const storage = new MemoryStorage();
    const setup = makeSetup({
      storage,
      normalResponses: [...normalPublication(), { status: 304 }],
    });
    await setup.core.initialize();
    await expect(setup.core.refresh()).resolves.toEqual({ status: 'updated' });
    expect(setup.events).toEqual([{ type: 'activation', publication: NORMAL_PUBLICATION }]);

    await expect(setup.core.refresh()).resolves.toEqual({ status: 'not-modified' });
    expect(setup.events).toHaveLength(1);

    const restarted = makeSetup({ storage, normalResponses: [{ status: 304 }] });
    expect((await restarted.core.initialize()).source).toBe('lkg');
    await expect(restarted.core.refresh()).resolves.toEqual({ status: 'not-modified' });
    expect(restarted.events).toEqual([]);
  });

  it('attaches the verified pointer identity to failures after pointer verification', async () => {
    const fetchSetup = makeSetup({
      normalResponses: [ok(pointerBytes('normal')), { status: 503 }],
    });
    await fetchSetup.core.initialize();
    await expectError(fetchSetup.core.refresh(), 'fetch');
    expect(fetchSetup.events).toMatchObject([
      { type: 'error', operation: 'normal-refresh', publication: NORMAL_PUBLICATION },
    ]);

    const changed = snapshotBytes('current');
    changed[changed.length - 2] ^= 1;
    const hashSetup = makeSetup({
      normalResponses: [ok(pointerBytes('normal')), ok(changed)],
    });
    await hashSetup.core.initialize();
    await expectError(hashSetup.core.refresh(), 'hash-mismatch');
    expect(hashSetup.events).toMatchObject([{ publication: NORMAL_PUBLICATION }]);
  });

  it('omits publication identity when no pointer was verified for the attempt', async () => {
    const setup = makeSetup({ normalResponses: [{ status: 503 }] });
    await setup.core.initialize();
    await expectError(setup.core.refresh(), 'fetch');
    expect(setup.events).toHaveLength(1);
    expect(setup.events[0]).not.toHaveProperty('publication');
  });

  it('keeps activation unaffected by a throwing report sink', async () => {
    const core = new ConfigCore({
      context: { appVersion: '2.5.0', locale: 'ZH_cn', os: 'windows' },
      crypto: TEST_CRYPTO,
      definitions: DEFINITIONS,
      emergencyKeyring: fixture.keys.emergency,
      emergencyNetwork: new QueueNetwork(),
      maximumSchemaVersion: 1,
      network: new QueueNetwork(normalPublication()),
      normalKeyring: fixture.keys.normal,
      report() {
        throw new Error('sink failed');
      },
      storage: new MemoryStorage(),
      target: TARGET,
    });
    await core.initialize();
    await expect(core.refresh()).resolves.toEqual({ status: 'updated' });
    expect(core.getState().source).toBe('remote');
  });
});

describe('ConfigCore emergency state', () => {
  it('rejects a 304 when no accepted emergency state exists', async () => {
    const setup = makeSetup({ emergencyResponses: [{ status: 304 }] });
    await setup.core.initialize();
    await expectError(setup.core.refreshEmergency(), 'fetch');
  });

  it('persists independently, fails open, and clears effects with a newer document', async () => {
    const storage = new MemoryStorage();
    const first = makeSetup({
      emergencyResponses: [ok(emergencyBytes('active'), '"e7"')],
      storage,
    });
    await first.core.initialize();
    await expect(first.core.refreshEmergency()).resolves.toEqual({ status: 'updated' });
    expect(first.core.get('feature.aiAssist')).toBe(false);
    expect(first.core.getState().emergency).toMatchObject({
      emergencyVersion: '7',
      forceMinVersion: '2.4.0',
    });

    const stable = makeSetup({
      emergencyResponses: [{ status: 503 }, ok(emergencyBytes('clear'), '"e8"'), { status: 304 }],
      storage,
      target: { ...TARGET, channel: 'stable' },
    });
    await stable.core.initialize();
    expect(stable.core.get('feature.aiAssist')).toBe(false);
    await expectError(stable.core.refreshEmergency(), 'fetch');
    expect(stable.core.get('feature.aiAssist')).toBe(false);
    await expect(stable.core.refreshEmergency()).resolves.toEqual({ status: 'updated' });
    expect(stable.core.get('feature.aiAssist')).toBe(true);
    expect(stable.core.getState().emergency).toMatchObject({ emergencyVersion: '8' });
    await expect(stable.core.refreshEmergency()).resolves.toEqual({ status: 'not-modified' });
    expect(stable.emergency.requests[2]?.request).toEqual({ etag: '"e8"' });
  });

  it('retains accepted state on replay, equivocation, and signature failure', async () => {
    const setup = makeSetup({
      emergencyResponses: [
        ok(emergencyBytes('active')),
        ok(emergencyBytes('clear')),
        ok(emergencyBytes('active')),
        ok(emergencyBytes('equivocation')),
        ok(emergencyBytes('tampered')),
      ],
    });
    await setup.core.initialize();
    await setup.core.refreshEmergency();
    await setup.core.refreshEmergency();
    await expectError(setup.core.refreshEmergency(), 'replay');
    await expectError(setup.core.refreshEmergency(), 'equivocation');
    await expectError(setup.core.refreshEmergency(), 'invalid-signature');
    expect(setup.core.getState().emergency?.emergencyVersion).toBe('8');
  });

  it('retains emergency replay high-water when a rotated-out key invalidates cached state', async () => {
    const storage = new MemoryStorage();
    const initial = makeSetup({ emergencyResponses: [ok(emergencyBytes('clear'))], storage });
    await initial.core.initialize();
    await initial.core.refreshEmergency();

    const withoutOldKey = makeSetup({ emergencyKeyring: {}, storage });
    expect((await withoutOldKey.core.initialize()).emergency).toBeNull();

    const restoredKey = makeSetup({
      emergencyResponses: [ok(emergencyBytes('active'))],
      storage,
    });
    await restoredKey.core.initialize();
    await expectError(restoredKey.core.refreshEmergency(), 'replay');
    const stored = JSON.parse(
      storage.values.get('linkcode-config:v1:emergency:acme:desktop') ?? '{}',
    ) as { highWater?: { version?: string } };
    expect(stored.highWater?.version).toBe('8');
  });
});

function makeSetup<Definitions extends ConfigDefinitions = typeof DEFINITIONS>(options?: {
  definitions?: Definitions;
  emergencyKeyring?: Readonly<Record<string, string>>;
  emergencyResponses?: ConfigNetworkResponse[];
  events?: ConfigEvent[];
  normalKeyring?: Readonly<Record<string, string>>;
  normalResponses?: ConfigNetworkResponse[];
  storage?: MemoryStorage;
  target?: ConfigTarget;
}) {
  const normal = new QueueNetwork(options?.normalResponses);
  const emergency = new QueueNetwork(options?.emergencyResponses);
  const storage = options?.storage ?? new MemoryStorage();
  const events = options?.events ?? [];
  const definitions = (options?.definitions ?? DEFINITIONS) as Definitions;
  const core = new ConfigCore({
    context: { appVersion: '2.5.0', locale: 'ZH_cn', os: 'windows' },
    crypto: TEST_CRYPTO,
    definitions,
    emergencyKeyring: options?.emergencyKeyring ?? fixture.keys.emergency,
    emergencyNetwork: emergency,
    maximumSchemaVersion: 1,
    network: normal,
    normalKeyring: options?.normalKeyring ?? fixture.keys.normal,
    report: (event) => events.push(event),
    storage,
    target: options?.target ?? TARGET,
  });
  return { core, emergency, events, normal, storage };
}

function normalPublication(): ConfigNetworkResponse[] {
  return [ok(pointerBytes('normal'), '"p100"'), ok(snapshotBytes('current'))];
}

function pointerBytes(name: keyof typeof fixture.pointers): Uint8Array {
  return documentBytes(fixture.pointers[name].document);
}

function emergencyBytes(name: keyof typeof fixture.emergencies): Uint8Array {
  return documentBytes(fixture.emergencies[name].document);
}

function snapshotBytes(name: 'current' | 'previous'): Uint8Array {
  return decodeBase64Url(fixture.snapshots[name].canonicalPayloadBase64Url);
}

function documentBytes(document: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(document));
}

function ok(body: Uint8Array, etag?: string): ConfigNetworkResponse {
  return { body, ...(etag && { etag }), status: 200 };
}

async function expectError(
  result: Promise<{ status: string; error?: { code: string } }>,
  code: string,
): Promise<void> {
  await expect(result).resolves.toMatchObject({ status: 'error', error: { code } });
}

function booleanDefinition(defaultValue: boolean) {
  return {
    defaultValue,
    parse(value: ConfigValue): boolean {
      if (typeof value !== 'boolean') throw new TypeError('Expected boolean');
      return value;
    },
  };
}

function numberDefinition(defaultValue: number) {
  return {
    defaultValue,
    parse(value: ConfigValue): number {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError('Expected number');
      }
      return value;
    },
  };
}

function stringDefinition(defaultValue: string) {
  return {
    defaultValue,
    parse(value: ConfigValue): string {
      if (typeof value !== 'string') throw new TypeError('Expected string');
      return value;
    },
  };
}

function objectDefinition(defaultValue: Record<string, JsonValue>) {
  return {
    defaultValue,
    parse(value: ConfigValue): Record<string, JsonValue> {
      if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object');
      return Object.fromEntries(Object.entries(value));
    },
  };
}

function arrayDefinition(defaultValue: JsonValue[]) {
  return {
    defaultValue,
    parse(value: ConfigValue): JsonValue[] {
      if (!Array.isArray(value)) throw new TypeError('Expected array');
      return [...value];
    },
  };
}
