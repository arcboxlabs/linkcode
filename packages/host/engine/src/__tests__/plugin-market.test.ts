import type {
  LinkCodeMarketplaceConfig,
  LinkCodeMarketplaceReleaseIdentity,
  LinkCodePluginRelease,
  ValidatedWireMessage,
  WirePayload,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { asyncNoop, noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import type { EngineDeps } from '../deps';
import type { InstalledLinkCodePluginEntry } from '../plugin/linkcode-store';
import { InMemoryLinkCodePluginStore } from '../plugin/linkcode-store';
import type {
  LinkCodeMarketplaceService,
  MarketplaceRefreshResult,
} from '../plugin/market-service';
import { createTestEngine } from './fixtures/test-engine';

const MARKETPLACE: LinkCodeMarketplaceConfig = {
  id: 'linkcode-official',
  displayName: 'LinkCode Official',
  source: { type: 'remote', url: 'https://plugins.linkcode.ai/index.json' },
  enabled: true,
};

const RELEASE: LinkCodePluginRelease = {
  manifest: {
    manifestVersion: 1,
    id: 'arcbox/latex',
    version: '1.2.0',
    keywords: [],
    components: [{ kind: 'skill', name: 'latex', entry: 'skills/latex/SKILL.md' }],
    assets: [],
  },
  artifact: {
    urls: ['https://plugins.linkcode.ai/arcbox/latex/1.2.0.tgz'],
    integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
    format: 'tgz',
  },
};

const IDENTITY = { marketplaceId: 'linkcode-official', pluginId: 'arcbox/latex', version: '1.2.0' };

function catalogKey(identity: LinkCodeMarketplaceReleaseIdentity): string {
  return `${identity.marketplaceId}/${identity.pluginId}/${identity.version}`;
}

/** A marketplace stub backed by a real catalog map: seeded with RELEASE, miss = empty catalog. */
function fakeMarketplace(overrides: Partial<LinkCodeMarketplaceService> = {}) {
  const catalog = new Map<string, LinkCodePluginRelease>([[catalogKey(IDENTITY), RELEASE]]);
  const resolveRelease = vi.fn((identity: LinkCodeMarketplaceReleaseIdentity) =>
    catalog.get(catalogKey(identity)),
  );
  const service: LinkCodeMarketplaceService = {
    list: () => [MARKETPLACE],
    refresh: () =>
      Promise.resolve<MarketplaceRefreshResult>({
        releases: [{ pluginId: 'arcbox/latex', release: RELEASE }],
      }),
    resolveRelease,
    ...overrides,
  };
  return { service, resolveRelease };
}

/** The in-memory store with spied install/uninstall; reassign either to force a rejection. */
function fakeStore() {
  const store = new InMemoryLinkCodePluginStore();
  const install = vi.fn((release: LinkCodePluginRelease, marketplaceId: string) =>
    Promise.resolve<InstalledLinkCodePluginEntry>({
      installed: {
        id: release.manifest.id,
        version: release.manifest.version,
        marketplaceId,
        integrity: release.artifact.integrity,
        enabled: true,
        path: '/store/arcbox/latex/1.2.0',
      },
      manifest: release.manifest,
    }),
  );
  const uninstall = vi.fn(asyncNoop);
  store.install = install;
  store.uninstall = uninstall;
  return { store, install, uninstall };
}

function harness(deps: EngineDeps = {}) {
  const sent: WirePayload[] = [];
  let handler: ((msg: ValidatedWireMessage) => void) | null = null;
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: ValidatedWireMessage) {
      sent.push(msg.payload);
    },
    onMessage(cb) {
      handler = cb;
      return noop;
    },
    onClose: () => noop,
    close: noop,
  };
  const engine = createTestEngine(transport, deps);
  function inject(payload: WirePayload): void {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
  }
  return { engine, sent, inject };
}

describe('plugin-market.list.get', () => {
  it('replies with the configured marketplaces', async () => {
    const { engine, sent, inject } = harness({ linkCodeMarketplace: fakeMarketplace().service });
    await engine.start();
    inject({ kind: 'plugin-market.list.get', clientReqId: 'r1' });
    expect(sent).toContainEqual({
      kind: 'plugin-market.listed',
      replyTo: 'r1',
      marketplaces: [MARKETPLACE],
    });
    await engine.stop();
  });

  it('replies with an empty list when the host has no marketplace plane', async () => {
    const { engine, sent, inject } = harness();
    await engine.start();
    inject({ kind: 'plugin-market.list.get', clientReqId: 'r1' });
    expect(sent).toContainEqual({ kind: 'plugin-market.listed', replyTo: 'r1', marketplaces: [] });
    await engine.stop();
  });
});

describe('plugin-market.refresh', () => {
  it('replies refreshed with the releases the daemon parsed', async () => {
    const { engine, sent, inject } = harness({ linkCodeMarketplace: fakeMarketplace().service });
    await engine.start();
    inject({
      kind: 'plugin-market.refresh',
      clientReqId: 'r1',
      marketplaceId: 'linkcode-official',
    });
    await vi.waitFor(() => {
      expect(sent).toContainEqual({
        kind: 'plugin-market.refreshed',
        replyTo: 'r1',
        marketplaceId: 'linkcode-official',
        releases: [{ pluginId: 'arcbox/latex', release: RELEASE }],
      });
    });
    await engine.stop();
  });

  it('carries the notModified flag through on an unchanged index', async () => {
    const { engine, sent, inject } = harness({
      linkCodeMarketplace: fakeMarketplace({
        refresh: () => Promise.resolve({ releases: [], notModified: true }),
      }).service,
    });
    await engine.start();
    inject({
      kind: 'plugin-market.refresh',
      clientReqId: 'r1',
      marketplaceId: 'linkcode-official',
    });
    await vi.waitFor(() => {
      expect(sent).toContainEqual({
        kind: 'plugin-market.refreshed',
        replyTo: 'r1',
        marketplaceId: 'linkcode-official',
        releases: [],
        notModified: true,
      });
    });
    await engine.stop();
  });

  it('fails not_found for an unconfigured marketplace without calling refresh', async () => {
    const refresh = vi.fn();
    const { engine, sent, inject } = harness({
      linkCodeMarketplace: fakeMarketplace({ refresh }).service,
    });
    await engine.start();
    inject({ kind: 'plugin-market.refresh', clientReqId: 'r1', marketplaceId: 'community' });
    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r1',
      code: 'not_found',
      message: 'Unknown marketplace: community',
    });
    expect(refresh).not.toHaveBeenCalled();
    await engine.stop();
  });

  it('refuses a disabled marketplace without calling refresh', async () => {
    const refresh = vi.fn();
    const { engine, sent, inject } = harness({
      linkCodeMarketplace: fakeMarketplace({
        list: () => [{ ...MARKETPLACE, enabled: false }],
        refresh,
      }).service,
    });
    await engine.start();
    inject({
      kind: 'plugin-market.refresh',
      clientReqId: 'r1',
      marketplaceId: 'linkcode-official',
    });
    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r1',
      code: 'forbidden',
      message: 'Marketplace is disabled: linkcode-official',
    });
    expect(refresh).not.toHaveBeenCalled();
    await engine.stop();
  });

  it('fails unsupported when the host has no marketplace plane', async () => {
    const { engine, sent, inject } = harness();
    await engine.start();
    inject({
      kind: 'plugin-market.refresh',
      clientReqId: 'r1',
      marketplaceId: 'linkcode-official',
    });
    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r1',
      code: 'unsupported',
      message: 'Plugin marketplaces are unavailable on this host',
    });
    await engine.stop();
  });

  it('fails the request without leaking the refresh error detail', async () => {
    const { engine, sent, inject } = harness({
      linkCodeMarketplace: fakeMarketplace({
        refresh: () => Promise.reject(new Error('secret upstream response')),
      }).service,
    });
    await engine.start();
    inject({
      kind: 'plugin-market.refresh',
      clientReqId: 'r1',
      marketplaceId: 'linkcode-official',
    });
    await vi.waitFor(() => {
      expect(sent).toContainEqual({
        kind: 'request.failed',
        replyTo: 'r1',
        code: 'operation_failed',
        message: 'Failed to refresh the marketplace index',
      });
    });
    expect(JSON.stringify(sent)).not.toContain('secret upstream response');
    await engine.stop();
  });
});

describe('plugin-market.install', () => {
  it('resolves the release from the cached catalog and installs it', async () => {
    const { store, install } = fakeStore();
    const { service, resolveRelease } = fakeMarketplace();
    const { engine, sent, inject } = harness({
      linkCodePluginStore: store,
      linkCodeMarketplace: service,
    });
    await engine.start();
    inject({ kind: 'plugin-market.install', clientReqId: 'r1', release: IDENTITY });
    await vi.waitFor(() => {
      expect(sent).toContainEqual({
        kind: 'plugin-market.installed',
        replyTo: 'r1',
        ...IDENTITY,
      });
    });
    expect(resolveRelease).toHaveBeenCalledWith(IDENTITY);
    expect(install).toHaveBeenCalledWith(RELEASE, 'linkcode-official');
    await engine.stop();
  });

  it('fails not_found when the release is absent from the cached catalog', async () => {
    const { store, install } = fakeStore();
    const { engine, sent, inject } = harness({
      linkCodePluginStore: store,
      linkCodeMarketplace: fakeMarketplace().service,
    });
    await engine.start();
    inject({
      kind: 'plugin-market.install',
      clientReqId: 'r1',
      release: { ...IDENTITY, version: '9.9.9' },
    });
    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r1',
      code: 'not_found',
      message: 'Unknown marketplace release: arcbox/latex@9.9.9',
    });
    expect(install).not.toHaveBeenCalled();
    await engine.stop();
  });

  it('refuses installs from a disabled marketplace without resolving or installing', async () => {
    const { store, install } = fakeStore();
    const { service, resolveRelease } = fakeMarketplace({
      list: () => [{ ...MARKETPLACE, enabled: false }],
    });
    const { engine, sent, inject } = harness({
      linkCodePluginStore: store,
      linkCodeMarketplace: service,
    });
    await engine.start();
    inject({ kind: 'plugin-market.install', clientReqId: 'r1', release: IDENTITY });
    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r1',
      code: 'forbidden',
      message: 'Marketplace is disabled: linkcode-official',
    });
    expect(resolveRelease).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    await engine.stop();
  });

  it('fails the request when the store install rejects', async () => {
    const { store } = fakeStore();
    store.install = () => Promise.reject(new Error('integrity mismatch detail'));
    const { engine, sent, inject } = harness({
      linkCodePluginStore: store,
      linkCodeMarketplace: fakeMarketplace().service,
    });
    await engine.start();
    inject({ kind: 'plugin-market.install', clientReqId: 'r1', release: IDENTITY });
    await vi.waitFor(() => {
      expect(sent).toContainEqual({
        kind: 'request.failed',
        replyTo: 'r1',
        code: 'operation_failed',
        message: 'Failed to install the plugin',
      });
    });
    expect(JSON.stringify(sent)).not.toContain('integrity mismatch detail');
    await engine.stop();
  });

  it('fails unsupported when the host has no marketplace plane', async () => {
    const { store } = fakeStore();
    const { engine, sent, inject } = harness({ linkCodePluginStore: store });
    await engine.start();
    inject({ kind: 'plugin-market.install', clientReqId: 'r1', release: IDENTITY });
    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r1',
      code: 'unsupported',
      message: 'Plugin marketplaces are unavailable on this host',
    });
    await engine.stop();
  });
});

describe('plugin-market.uninstall', () => {
  it('uninstalls through the store and replies with the plugin id', async () => {
    const { store, uninstall } = fakeStore();
    const { engine, sent, inject } = harness({ linkCodePluginStore: store });
    await engine.start();
    inject({ kind: 'plugin-market.uninstall', clientReqId: 'r1', pluginId: 'arcbox/latex' });
    await vi.waitFor(() => {
      expect(sent).toContainEqual({
        kind: 'plugin-market.uninstalled',
        replyTo: 'r1',
        pluginId: 'arcbox/latex',
      });
    });
    expect(uninstall).toHaveBeenCalledWith('arcbox/latex');
    await engine.stop();
  });

  it('fails the request when the store uninstall rejects', async () => {
    const { store } = fakeStore();
    store.uninstall = () => Promise.reject(new Error('disk full'));
    const { engine, sent, inject } = harness({ linkCodePluginStore: store });
    await engine.start();
    inject({ kind: 'plugin-market.uninstall', clientReqId: 'r1', pluginId: 'arcbox/latex' });
    await vi.waitFor(() => {
      expect(sent).toContainEqual({
        kind: 'request.failed',
        replyTo: 'r1',
        code: 'operation_failed',
        message: 'Failed to uninstall the plugin',
      });
    });
    await engine.stop();
  });
});
