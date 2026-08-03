import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigNetwork, ConfigNetworkResponse, ConfigValue } from '@linkcode/common/config';
import {
  configBuildBundleDefaults,
  decodeBase64Url,
  MAX_SNAPSHOT_SIZE_BYTES,
  parseConfigBuildBundle,
} from '@linkcode/common/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopConfigBootstrap } from '../config';
import { DesktopConfigService, loadEffectiveDefaults, parseBootstrap } from '../config';
import { AtomicConfigStorage, FetchConfigNetwork, nodeConfigCrypto } from '../config-adapters';

vi.mock('electron', () => ({
  app: {
    commandLine: { getSwitchValue: () => '', hasSwitch: () => false },
    getLocale: () => 'en-US',
    getPath: () => '/unused',
    getVersion: () => '2.4.0',
    isPackaged: false,
  },
  dialog: { showErrorBox: vi.fn() },
}));

interface Fixture {
  readonly keys: { readonly normal: Readonly<Record<string, string>> };
  readonly pointers: {
    readonly normal: { readonly document: unknown };
  };
  readonly snapshots: {
    readonly current: { readonly canonicalPayloadBase64Url: string };
    readonly previous: { readonly document: { readonly values: Record<string, ConfigValue> } };
  };
}

const temporaryDirectories: string[] = [];

class SequenceNetwork implements ConfigNetwork {
  readonly #responses: ConfigNetworkResponse[];
  #index = 0;

  constructor(responses: ConfigNetworkResponse[]) {
    this.#responses = responses;
  }

  get(): Promise<ConfigNetworkResponse> {
    const response = this.#responses.at(this.#index++);
    return response ? Promise.resolve(response) : Promise.reject(new Error('offline'));
  }
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('desktop config runtime', () => {
  it('atomically persists values under the config directory', async () => {
    const directory = await temporaryDirectory();
    const storage = new AtomicConfigStorage(directory);
    await storage.set('normal:key', 'first');
    await storage.set('normal:key', 'second');

    expect(await storage.get('normal:key')).toBe('second');
    expect(await storage.get('missing')).toBeNull();
    expect(await readFile(join(directory, 'bm9ybWFsOmtleQ.json'), 'utf8')).toBe('second');
  });

  it('applies hot keys now, stages cold keys, then boots cold keys from verified LKG offline', async () => {
    const fixture = await loadFixture();
    const directory = await temporaryDirectory();
    const defaults = {
      ...fixture.snapshots.previous.document.values,
      'feature.newEditor': false,
    };
    const bootstrap = makeBootstrap(defaults, fixture.keys.normal);
    const storage = new AtomicConfigStorage(directory);
    const online = makeService(
      bootstrap,
      storage,
      new SequenceNetwork([
        ok(documentBytes(fixture.pointers.normal.document), '"normal"'),
        ok(decodeBase64Url(fixture.snapshots.current.canonicalPayloadBase64Url)),
      ]),
    );
    const hotUpdates: string[][] = [];
    online.onHotUpdate((keys) => hotUpdates.push([...keys]));

    await online.initialize();
    await expect(online.refresh()).resolves.toMatchObject({ normal: 'updated' });
    expect(online.effectiveSnapshot()['content.home.banner']).toEqual({
      title: 'Build with LinkCode',
      url: 'https://linkcode.ai/docs',
    });
    expect(online.effectiveSnapshot()['feature.legacy']).toBe(true);
    expect(online.snapshotInfo()).toMatchObject({
      source: 'remote',
      stagedColdKeys: ['feature.legacy', 'feature.newEditor'],
      status: 'READY',
    });
    expect(hotUpdates.flat()).toContain('content.home.banner');
    expect(hotUpdates.flat()).not.toContain('feature.legacy');

    const offline = makeService(bootstrap, storage);
    await offline.initialize();
    expect(offline.effectiveSnapshot()['feature.legacy']).toBe(false);
    expect(offline.effectiveSnapshot()['feature.newEditor']).toBe(true);
    expect(offline.snapshotInfo()).toMatchObject({ source: 'cache', status: 'READY' });
  });

  it('ignores local overrides when a packaged build disables them', async () => {
    const directory = await temporaryDirectory();
    const overridePath = join(directory, 'override.json');
    await writeFile(overridePath, JSON.stringify({ 'ui.theme': 'overridden' }));

    await expect(
      loadEffectiveDefaults({ 'ui.theme': 'bundled' }, overridePath, false),
    ).resolves.toEqual({ 'ui.theme': 'bundled' });
    await expect(
      loadEffectiveDefaults({ 'ui.theme': 'bundled' }, overridePath, true),
    ).resolves.toEqual({ 'ui.theme': 'overridden' });
  });

  it('treats remote JavaScript as malformed data without executing or activating it', async () => {
    const service = makeService(
      makeBootstrap({ 'feature.safe': true }, {}),
      new AtomicConfigStorage(await temporaryDirectory()),
      new SequenceNetwork([ok(new TextEncoder().encode('globalThis.compromised = true'))]),
    );
    await service.initialize();

    await expect(service.refresh()).resolves.toMatchObject({ normal: 'error' });
    expect(service.effectiveSnapshot()).toEqual({ 'feature.safe': true });
    expect(globalThis).not.toHaveProperty('compromised');
  });

  it('coalesces concurrent renderer and timer refreshes into one operation', async () => {
    const network = new SequenceNetwork([ok(new TextEncoder().encode('{}'))]);
    const service = makeService(
      makeBootstrap({ 'feature.safe': true }, {}),
      new AtomicConfigStorage(await temporaryDirectory()),
      network,
    );
    await service.initialize();

    const first = service.refresh();
    const second = service.refresh();
    expect(first).toBe(second);
    await first;
  });

  it('bounds response bytes and prevents endpoint path escape', async () => {
    const network = new FetchConfigNetwork('https://config.example/base');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(new Uint8Array(MAX_SNAPSHOT_SIZE_BYTES + 1), {
            headers: { 'content-length': String(MAX_SNAPSHOT_SIZE_BYTES + 1) },
            status: 200,
          }),
        ),
      ),
    );

    await expect(network.get('snapshot.json', {})).rejects.toThrow('exceeds maximum size');
    await expect(network.get('../escape.json', {})).rejects.toThrow('escaped endpoint');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('build-bundle derived bootstrap', () => {
  it('parses the generated bootstrap shape and preserves the telemetry endpoint', async () => {
    const bootstrap = parseBootstrap(JSON.stringify(await bundleBootstrap()));
    const bundle = parseConfigBuildBundle(await loadBuildBundleFixture());
    expect(bootstrap.brandId).toBe(bundle.brandId);
    expect(bootstrap.channel).toBe(bundle.channel);
    expect(bootstrap.defaults).toEqual(configBuildBundleDefaults(bundle));
    expect(bootstrap.telemetryEndpoint).toBe(bundle.endpoints.telemetry);
  });

  it('defaults the telemetry endpoint to null and rejects non-HTTPS values', async () => {
    expect(parseBootstrap(undefined).telemetryEndpoint).toBeNull();
    const bootstrap = await bundleBootstrap();
    expect(() =>
      parseBootstrap(JSON.stringify({ ...bootstrap, telemetryEndpoint: 'http://x.example' })),
    ).toThrow('Config endpoints must use HTTPS');
  });

  it('starts offline from bundled defaults without any network wait', async () => {
    const bootstrap = parseBootstrap(JSON.stringify(await bundleBootstrap()));
    // No network adapters at all — a new install must serve rendered defaults immediately.
    const service = makeService(bootstrap, new AtomicConfigStorage(await temporaryDirectory()));
    await service.initialize();
    expect(service.effectiveSnapshot()).toEqual(bootstrap.defaults);
    expect(service.snapshotInfo()).toMatchObject({ source: 'bundled', status: 'READY' });
    await expect(service.refresh()).resolves.toMatchObject({
      emergency: 'disabled',
      normal: 'disabled',
    });
  });
});

// Mirrors the derivation in scripts/render-config-bundle.mts.
async function bundleBootstrap(): Promise<Record<string, unknown>> {
  const bundle = parseConfigBuildBundle(await loadBuildBundleFixture());
  return {
    brandId: bundle.brandId,
    channel: bundle.channel,
    defaults: configBuildBundleDefaults(bundle),
    emergencyEndpoint: bundle.endpoints.emergency,
    emergencyPublicKeys: bundle.keyrings.emergency,
    endpoint: bundle.endpoints.normal,
    maximumSchemaVersion: bundle.maximumSchemaVersion,
    publicKeys: bundle.keyrings.normal,
    telemetryEndpoint: bundle.endpoints.telemetry,
  };
}

async function loadBuildBundleFixture(): Promise<unknown> {
  const url = new URL(
    '../../../../../packages/foundation/common/src/config/__fixtures__/build-bundle-v1.json',
    import.meta.url,
  );
  return JSON.parse(await readFile(url, 'utf8'));
}

function makeService(
  bootstrap: DesktopConfigBootstrap,
  storage: AtomicConfigStorage,
  network?: ConfigNetwork,
): DesktopConfigService {
  return new DesktopConfigService({
    bootstrap,
    context: { appVersion: '2.4.0', locale: 'en-US', os: 'linux' },
    crypto: nodeConfigCrypto,
    ...(network && { network }),
    storage,
  });
}

function makeBootstrap(
  defaults: Readonly<Record<string, ConfigValue>>,
  publicKeys: Readonly<Record<string, string>>,
): DesktopConfigBootstrap {
  return {
    brandId: 'acme',
    channel: 'canary',
    defaults,
    emergencyEndpoint: null,
    emergencyPublicKeys: {},
    endpoint: null,
    maximumSchemaVersion: 1,
    publicKeys,
    telemetryEndpoint: null,
  };
}

function ok(body: Uint8Array, etag?: string): ConfigNetworkResponse {
  return { body, ...(etag && { etag }), status: 200 };
}

function documentBytes(document: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(document));
}

async function loadFixture(): Promise<Fixture> {
  const url = new URL(
    '../../../../../packages/foundation/common/src/config/__fixtures__/contract-v1.json',
    import.meta.url,
  );
  return JSON.parse(await readFile(url, 'utf8')) as Fixture;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'linkcode-config-test-'));
  temporaryDirectories.push(directory);
  return directory;
}
