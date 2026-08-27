import type { LinkCodePluginManifest } from '@linkcode/schema';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { RequestError } from '../failure';
import { PluginConfigService } from '../plugin/config-service';
import type { InstalledLinkCodePluginEntry } from '../plugin/linkcode-store';
import { InMemoryLinkCodePluginStore } from '../plugin/linkcode-store';

const MANIFEST: LinkCodePluginManifest = {
  manifestVersion: 1,
  id: 'linkcode/mail',
  version: '0.1.0',
  keywords: [],
  components: [{ kind: 'mcp-server', name: 'mail', command: 'node', entry: 'dist/index.js' }],
  settings: {
    account: { type: 'string', required: true },
    authcode: { type: 'password', secret: true, required: true },
    token: { type: 'password', secret: true },
    preset: { type: 'enum', enum: ['163', 'qq'], default: '163' },
  },
  assets: [],
};

const ENTRY: InstalledLinkCodePluginEntry = {
  installed: {
    id: 'linkcode/mail',
    version: '0.1.0',
    marketplaceId: 'linkcode-official',
    integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
    enabled: true,
    path: '/store/linkcode/mail/0.1.0',
  },
  manifest: MANIFEST,
};

function harness(settings: Record<string, string | number | boolean> = {}) {
  const store = new InMemoryLinkCodePluginStore();
  store.seed(ENTRY, settings);
  return { store, service: new PluginConfigService(store) };
}

describe('PluginConfigService', () => {
  it('exposes secret presence bits without ever exposing the values', async () => {
    const { store, service } = harness({
      account: 'you@163.com',
      authcode: 's3cret',
      token: 't0ken',
    });

    const [view] = service.list();
    expect(view?.values).toEqual({ account: 'you@163.com', preset: '163' });
    expect(view?.configuredSecrets).toEqual(['authcode', 'token']);
    expect(JSON.stringify(view)).not.toContain('s3cret');
    expect(JSON.stringify(view)).not.toContain('t0ken');

    await store.setSettings('linkcode/mail', { remove: ['token'] });
    expect(service.list()[0]?.configuredSecrets).toEqual(['authcode']);
  });

  it('maps a manifest-violating patch to invalid_request and persists nothing', async () => {
    const { store, service } = harness({ account: 'you@163.com', authcode: 's3cret' });

    const typeError = await Effect.runPromise(
      service.applyPatch('linkcode/mail', { set: { account: 42 } }).pipe(Effect.flip),
    );
    expect(typeError).toBeInstanceOf(RequestError);
    expect((typeError as RequestError).code).toBe('invalid_request');

    const requiredError = await Effect.runPromise(
      service.applyPatch('linkcode/mail', { remove: ['authcode'] }).pipe(Effect.flip),
    );
    expect((requiredError as RequestError).code).toBe('invalid_request');

    // The UI never sends a blank secret ("blank = keep"); the daemon boundary refuses one.
    const emptySecretError = await Effect.runPromise(
      service.applyPatch('linkcode/mail', { set: { authcode: '' } }).pipe(Effect.flip),
    );
    expect((emptySecretError as RequestError).code).toBe('invalid_request');

    expect(store.getSettings('linkcode/mail')).toMatchObject({
      account: 'you@163.com',
      authcode: 's3cret',
    });
  });

  it('rejects a patch for an unknown plugin as not_found', async () => {
    const { service } = harness();
    const error = await Effect.runPromise(
      service.applyPatch('linkcode/ghost', { set: { account: 'x' } }).pipe(Effect.flip),
    );
    expect((error as RequestError).code).toBe('not_found');
  });
});
