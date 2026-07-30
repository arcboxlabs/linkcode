import type { CustomMcpServer } from '@linkcode/schema';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { CustomMcpServerService } from '../agent/custom-mcp-service';
import { InMemoryProviderConfigStore } from '../agent/provider-config';

function stdioServer(overrides: Partial<CustomMcpServer> = {}): CustomMcpServer {
  return {
    id: 'custom-1',
    enabled: true,
    server: {
      type: 'stdio',
      name: 'github',
      command: 'gh-mcp',
      args: ['--stdio'],
      env: { GITHUB_TOKEN: 'secret', LOG_LEVEL: 'info' },
    },
    createdAt: 1,
    ...overrides,
  };
}

function seeded(...servers: CustomMcpServer[]) {
  const store = new InMemoryProviderConfigStore();
  store.setCustomMcpServers(servers);
  return { store, service: new CustomMcpServerService(store) };
}

describe('CustomMcpServerService', () => {
  it('adds, masks, and removes servers through patches', async () => {
    const { store, service } = seeded();

    await Effect.runPromise(service.applyPatch([{ op: 'add', server: stdioServer() }]));

    expect(service.listPublic()).toEqual([
      {
        id: 'custom-1',
        enabled: true,
        server: {
          type: 'stdio',
          name: 'github',
          command: 'gh-mcp',
          args: ['--stdio'],
          envKeys: ['GITHUB_TOKEN', 'LOG_LEVEL'],
        },
        createdAt: 1,
      },
    ]);

    await Effect.runPromise(service.applyPatch([{ op: 'remove', id: 'custom-1' }]));
    expect(store.getCustomMcpServers()).toEqual([]);
  });

  it('flips enabled without touching stored secrets', async () => {
    const { store, service } = seeded(stdioServer());

    await Effect.runPromise(service.applyPatch([{ op: 'update', id: 'custom-1', enabled: false }]));

    const [entry] = store.getCustomMcpServers();
    expect(entry.enabled).toBe(false);
    expect(entry.server).toEqual(stdioServer().server);
  });

  it('applies per-key secret set/remove and preserves untouched keys', async () => {
    const { store, service } = seeded(stdioServer());

    await Effect.runPromise(
      service.applyPatch([
        {
          op: 'update',
          id: 'custom-1',
          server: {
            type: 'stdio',
            name: 'github',
            command: 'gh-mcp-v2',
            env: { set: { GITHUB_TOKEN: 'rotated' }, remove: ['LOG_LEVEL'] },
          },
        },
      ]),
    );

    const [entry] = store.getCustomMcpServers();
    expect(entry.server).toEqual({
      type: 'stdio',
      name: 'github',
      command: 'gh-mcp-v2',
      args: undefined,
      env: { GITHUB_TOKEN: 'rotated' },
    });
  });

  it('keeps stored secrets when the update carries no secret patch', async () => {
    const { store, service } = seeded(stdioServer());

    await Effect.runPromise(
      service.applyPatch([
        {
          op: 'update',
          id: 'custom-1',
          server: { type: 'stdio', name: 'github-renamed', command: 'gh-mcp' },
        },
      ]),
    );

    const [entry] = store.getCustomMcpServers();
    expect(entry.server.name).toBe('github-renamed');
    expect(entry.server.type === 'stdio' && entry.server.env).toEqual({
      GITHUB_TOKEN: 'secret',
      LOG_LEVEL: 'info',
    });
  });

  it('rejects a transport type change on update', async () => {
    const { service } = seeded(stdioServer());

    const outcome = await Effect.runPromise(
      Effect.flip(
        service.applyPatch([
          {
            op: 'update',
            id: 'custom-1',
            server: { type: 'http', name: 'github', url: 'https://mcp.example' },
          },
        ]),
      ),
    );

    expect(outcome).toMatchObject({ _tag: 'RequestError', code: 'invalid_request' });
  });

  it('rejects duplicate names, duplicate ids, and reserved names', async () => {
    const { service } = seeded(stdioServer());

    const duplicateName = await Effect.runPromise(
      Effect.flip(
        service.applyPatch([
          {
            op: 'add',
            server: stdioServer({
              id: 'custom-2',
              server: { type: 'http', name: 'github', url: 'https://mcp.example' },
            }),
          },
        ]),
      ),
    );
    const duplicateId = await Effect.runPromise(
      Effect.flip(service.applyPatch([{ op: 'add', server: stdioServer() }])),
    );
    const reserved = await Effect.runPromise(
      Effect.flip(
        service.applyPatch([
          {
            op: 'add',
            server: stdioServer({
              id: 'custom-3',
              server: { type: 'http', name: 'linkcode-sim', url: 'https://mcp.example' },
            }),
          },
        ]),
      ),
    );

    expect(duplicateName).toMatchObject({ _tag: 'RequestError', code: 'conflict' });
    expect(duplicateId).toMatchObject({ _tag: 'RequestError', code: 'conflict' });
    expect(reserved).toMatchObject({ _tag: 'RequestError', code: 'conflict' });
  });

  it('leaves the store untouched when any op in the patch fails', async () => {
    const { store, service } = seeded(stdioServer());

    await Effect.runPromise(
      Effect.flip(
        service.applyPatch([
          { op: 'update', id: 'custom-1', enabled: false },
          { op: 'update', id: 'missing', enabled: true },
        ]),
      ),
    );

    expect(store.getCustomMcpServers()).toEqual([stdioServer()]);
  });
});
