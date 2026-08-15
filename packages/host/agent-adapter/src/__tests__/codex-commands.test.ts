import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, StartOptions } from '@linkcode/schema';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { CodexServerHandle } from '../native/codex/adapter';
import {
  CodexAdapter,
  capSkillIconPayload,
  codexSkillCommands,
  skillIconDataUri,
} from '../native/codex/adapter';
import type { CodexAppServerOptions } from '../native/codex/app-server';

class FakeCodexServer {
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  rejectSkills = false;
  compactResponse: Promise<unknown> = Promise.resolve({});
  private turn = 0;

  constructor(
    private readonly opts: Omit<CodexAppServerOptions, 'binaryPath'>,
    public skillsResponse: unknown,
  ) {}

  request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params: params as Record<string, unknown> });
    if (method === 'thread/start') return Promise.resolve({ thread: { id: 'thread-1' } });
    if (method === 'skills/list') {
      return this.rejectSkills
        ? Promise.reject(new Error('skills unavailable'))
        : Promise.resolve(this.skillsResponse);
    }
    if (method === 'turn/start') {
      this.turn += 1;
      return Promise.resolve({ turn: { id: `turn-${this.turn}` } });
    }
    if (method === 'thread/compact/start') return this.compactResponse;
    return Promise.resolve({});
  }

  setRequestHandler(): void {
    // These command-path tests never trigger approval requests.
  }
  close(): void {
    // Nothing to reap.
  }
  notify(method: string, params: unknown): void {
    this.opts.onNotification(method, params);
  }
}

class TestCodex extends CodexAdapter {
  fake!: FakeCodexServer;

  constructor(
    private readonly skillsResponse: unknown,
    private readonly rejectSkills = false,
  ) {
    super();
  }

  protected override startAppServer(
    opts: Omit<CodexAppServerOptions, 'binaryPath'>,
  ): Promise<CodexServerHandle> {
    this.fake = new FakeCodexServer(opts, this.skillsResponse);
    this.fake.rejectSkills = this.rejectSkills;
    return Promise.resolve(this.fake);
  }

  protected override readConfiguredSandbox() {
    return Promise.resolve(undefined);
  }
}

const start: StartOptions = { kind: 'codex', cwd: '/repo' };

function response(...skills: Array<Record<string, unknown>>): unknown {
  return { data: [{ cwd: '/repo', skills, errors: [] }] };
}

function catalog(events: AgentEvent[]) {
  return events.filter(
    (event): event is Extract<AgentEvent, { type: 'available-commands-update' }> =>
      event.type === 'available-commands-update',
  );
}

describe('CodexAdapter slash commands', () => {
  it('maps enabled skills, deduplicates names, and keeps provider paths private', () => {
    expect(
      codexSkillCommands(
        response(
          { name: 'zeta', description: 'Z', path: '/z/SKILL.md', enabled: true },
          { name: 'alpha', description: 'A', path: '/a/SKILL.md', enabled: true },
          { name: 'alpha', description: 'duplicate', path: '/other/SKILL.md', enabled: true },
          { name: 'off', description: 'disabled', path: '/off/SKILL.md', enabled: false },
        ),
      ),
    ).toEqual([
      { name: 'alpha', description: 'A', path: '/a/SKILL.md' },
      { name: 'zeta', description: 'Z', path: '/z/SKILL.md' },
    ]);
  });

  it('projects skill brand identity, preferring the small icon and validating the color', () => {
    expect(
      codexSkillCommands(
        response(
          {
            name: 'documents',
            description: 'Docs',
            path: '/skills/documents/SKILL.md',
            enabled: true,
            interface: {
              displayName: 'Documents',
              brandColor: '#2563EB',
              iconSmall: '/plugins/documents/assets/small.png',
              iconLarge: '/plugins/documents/assets/large.png',
            },
          },
          {
            name: 'plain',
            description: 'No brand',
            path: '/skills/plain/SKILL.md',
            enabled: true,
            interface: { brandColor: 'blue', iconLarge: '/plugins/plain/assets/large.png' },
          },
        ),
      ),
    ).toEqual([
      {
        name: 'documents',
        description: 'Docs',
        displayName: 'Documents',
        brandColor: '#2563EB',
        path: '/skills/documents/SKILL.md',
        iconPath: '/plugins/documents/assets/small.png',
      },
      {
        name: 'plain',
        description: 'No brand',
        path: '/skills/plain/SKILL.md',
        iconPath: '/plugins/plain/assets/large.png',
      },
    ]);
  });

  it('publishes /compact plus the skills/list catalog at session start', async () => {
    const adapter = new TestCodex(
      response(
        {
          name: 'review',
          description: 'Review code',
          path: '/skills/review.md',
          enabled: true,
        },
        {
          name: 'compact',
          description: 'Skill collision',
          path: '/skills/compact.md',
          enabled: true,
        },
      ),
    );
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));

    await adapter.start(start);

    expect(
      adapter.fake.requests.find((request) => request.method === 'skills/list')?.params,
    ).toEqual({ cwds: ['/repo'], forceReload: false });
    expect(catalog(events).at(-1)?.commands).toEqual([
      {
        name: 'compact',
        description: 'Summarize conversation to prevent hitting the context limit',
      },
      { name: 'review', description: 'Review code' },
    ]);
  });

  it('keeps /compact available when skills/list fails without failing session start', async () => {
    const adapter = new TestCodex(response(), true);
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));

    await adapter.start(start);

    expect(catalog(events).at(-1)?.commands).toEqual([
      {
        name: 'compact',
        description: 'Summarize conversation to prevent hitting the context limit',
      },
    ]);
    expect(events.some((event) => event.type === 'status' && event.status === 'idle')).toBe(true);
  });

  it('invokes a skill with the structured provider input and visible $name arguments', async () => {
    const adapter = new TestCodex(
      response({
        name: 'review',
        description: 'Review code',
        path: '/skills/review.md',
        enabled: true,
      }),
    );
    await adapter.start(start);

    await adapter.send({ type: 'command', name: 'review', arguments: 'src/main.ts' });

    expect(
      adapter.fake.requests.find((request) => request.method === 'turn/start')?.params,
    ).toMatchObject({
      threadId: 'thread-1',
      input: [
        { type: 'skill', name: 'review', path: '/skills/review.md' },
        { type: 'text', text: '$review src/main.ts', text_elements: [] },
      ],
    });
  });

  it('refreshes the full catalog after skills/changed', async () => {
    const adapter = new TestCodex(
      response({ name: 'old', description: 'Old', path: '/skills/old.md', enabled: true }),
    );
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));
    await adapter.start(start);
    adapter.fake.skillsResponse = response({
      name: 'new',
      description: 'New',
      path: '/skills/new.md',
      enabled: true,
    });

    adapter.fake.notify('skills/changed', {});

    await vi.waitFor(() => expect(catalog(events)).toHaveLength(3));
    const refreshed = catalog(events).at(-1);
    expect(refreshed?.commands.map((command) => command.name)).toEqual(['compact', 'new']);
  });

  it('drops invalidated skill paths when the refresh fails', async () => {
    const adapter = new TestCodex(
      response({ name: 'old', description: 'Old', path: '/skills/old.md', enabled: true }),
    );
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));
    await adapter.start(start);
    adapter.fake.rejectSkills = true;

    adapter.fake.notify('skills/changed', {});

    await vi.waitFor(() => expect(catalog(events)).toHaveLength(3));
    const latest = catalog(events).at(-1);
    expect(latest?.commands.map((command) => command.name)).toEqual(['compact']);
    await expect(adapter.send({ type: 'command', name: 'old' })).rejects.toThrow(
      "codex: unknown slash command '/old'",
    );
  });

  it('queues structured skill inputs behind an active turn', async () => {
    const adapter = new TestCodex(
      response({ name: 'review', description: 'Review', path: '/skills/review.md', enabled: true }),
    );
    await adapter.start(start);
    await adapter.send({ type: 'command', name: 'review', arguments: 'first' });
    await adapter.send({ type: 'command', name: 'review', arguments: 'second' });
    expect(adapter.fake.requests.filter((request) => request.method === 'turn/start')).toHaveLength(
      1,
    );

    adapter.fake.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });

    await vi.waitFor(() => {
      expect(
        adapter.fake.requests.filter((request) => request.method === 'turn/start'),
      ).toHaveLength(2);
    });
    const secondTurn = adapter.fake.requests.filter(
      (request) => request.method === 'turn/start',
    )[1];
    expect(secondTurn.params.input).toEqual([
      { type: 'skill', name: 'review', path: '/skills/review.md' },
      { type: 'text', text: '$review second', text_elements: [] },
    ]);
  });

  it('dispatches /compact out of band and rejects names outside the catalog', async () => {
    const adapter = new TestCodex(response());
    await adapter.start(start);

    await adapter.send({ type: 'command', name: 'compact' });
    expect(
      adapter.fake.requests.find((request) => request.method === 'thread/compact/start')?.params,
    ).toEqual({ threadId: 'thread-1' });
    await expect(adapter.send({ type: 'command', name: 'missing' })).rejects.toThrow(
      "codex: unknown slash command '/missing'",
    );
  });

  it('stays running after the /compact ack and settles from its compaction turn', async () => {
    const adapter = new TestCodex(response());
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));
    await adapter.start(start);
    events.length = 0;
    let resolveCompact!: (value: unknown) => void;
    adapter.fake.compactResponse = new Promise((resolve) => {
      resolveCompact = resolve;
    });

    const sending = adapter.send({ type: 'command', name: 'compact' });
    let settled = false;
    void sending.then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(events).toContainEqual({ type: 'status', status: 'running' }));
    expect(settled).toBe(false);
    resolveCompact({});
    await sending;

    expect(events.filter((event) => event.type === 'status')).toEqual([
      { type: 'status', status: 'running' },
    ]);
    // thread/compact/start returns an empty ack before app-server 0.144.1 runs compaction as a
    // normal turn. The standard notifications — not the request response — own settlement.
    adapter.fake.notify('turn/started', { turn: { id: 'compact-turn' } });
    adapter.fake.notify('item/started', {
      item: { id: 'compaction-1', type: 'contextCompaction' },
    });
    adapter.fake.notify('item/completed', {
      item: { id: 'compaction-1', type: 'contextCompaction' },
    });
    adapter.fake.notify('turn/completed', {
      turn: { id: 'compact-turn', status: 'completed' },
    });

    expect(events.filter((event) => event.type === 'compaction')).toEqual([
      { type: 'compaction', compactionId: 'compaction-1', status: 'in_progress' },
      { type: 'compaction', compactionId: 'compaction-1', status: 'completed' },
    ]);
    expect(events).toContainEqual({ type: 'stop', stopReason: 'end_turn' });
    expect(events.at(-1)).toEqual({ type: 'status', status: 'idle' });
  });

  it('returns /compact to idle when its request is rejected', async () => {
    const adapter = new TestCodex(response());
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));
    await adapter.start(start);
    events.length = 0;
    adapter.fake.compactResponse = Promise.reject(new Error('compact unavailable'));

    await expect(adapter.send({ type: 'command', name: 'compact' })).rejects.toThrow(
      'compact unavailable',
    );

    expect(events.filter((event) => event.type === 'status')).toEqual([
      { type: 'status', status: 'running' },
      { type: 'status', status: 'idle' },
    ]);
  });
});

async function createIconTempDir(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'codex-skill-icon-')));
}

describe('codex skill icons', () => {
  const dirPromise = createIconTempDir();
  afterAll(async () => {
    await rm(await dirPromise, { force: true, recursive: true });
  });

  it('embeds a small icon file as a data URI and refuses non-icons', async () => {
    const dir = await dirPromise;
    const iconPath = join(dir, 'icon.png');
    const iconBytes = Buffer.from('89504E470D0A1A0A6D6F636B', 'hex');
    await writeFile(iconPath, iconBytes);
    const oversizedPath = join(dir, 'oversized.png');
    await writeFile(oversizedPath, Buffer.alloc(33 * 1024, 1));
    const fakePngPath = join(dir, 'fake.png');
    await writeFile(fakePngPath, 'not an image');
    const wrongExtensionPath = join(dir, 'wrong-extension.jpg');
    await writeFile(wrongExtensionPath, iconBytes);

    expect(await skillIconDataUri(iconPath)).toBe(
      `data:image/png;base64,${iconBytes.toString('base64')}`,
    );
    expect(await skillIconDataUri(oversizedPath)).toBeUndefined();
    expect(await skillIconDataUri(fakePngPath)).toBeUndefined();
    expect(await skillIconDataUri(wrongExtensionPath)).toBeUndefined();
    expect(await skillIconDataUri(join(dir, 'missing.png'))).toBeUndefined();
    expect(await skillIconDataUri(join(dir, 'icon.bmp'))).toBeUndefined();
  });

  it('rejects icons reached through a symlinked parent directory', async () => {
    const dir = await dirPromise;
    const assetsDir = join(dir, 'real-assets');
    await mkdir(assetsDir);
    await writeFile(join(assetsDir, 'icon.png'), Buffer.from('89504E470D0A1A0A', 'hex'));
    const linkedDir = join(dir, 'linked-assets');
    await symlink(assetsDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');

    expect(await skillIconDataUri(join(linkedDir, 'icon.png'))).toBeUndefined();
  });

  it('rejects SVG icons carrying active content, keeping fragment-ref-only ones', async () => {
    const dir = await dirPromise;
    const svg = async (name: string, body: string) => {
      const path = join(dir, name);
      await writeFile(path, `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
      return skillIconDataUri(path);
    };

    expect(
      await svg('scripted.svg', '<script>fetch("https://x.example")</script>'),
    ).toBeUndefined();
    expect(await svg('handler.svg', '<rect onload="alert(1)"/>')).toBeUndefined();
    expect(await svg('external.svg', '<use href="https://x.example/a.svg#i"/>')).toBeUndefined();
    expect(await svg('foreign.svg', '<foreignObject><div/></foreignObject>')).toBeUndefined();
    expect(
      await svg(
        'clean.svg',
        '<defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use xlink:href="#g"/>',
      ),
    ).toBeDefined();
  });

  it('publishes the embedded icon on the catalog while keeping paths private', async () => {
    const dir = await dirPromise;
    const iconPath = join(dir, 'documents.svg');
    await writeFile(iconPath, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const adapter = new TestCodex(
      response({
        name: 'documents',
        description: 'Docs',
        path: '/skills/documents/SKILL.md',
        enabled: true,
        interface: { displayName: 'Documents', brandColor: '#2563EB', iconSmall: iconPath },
      }),
    );
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));

    await adapter.start(start);

    const commands = catalog(events).at(-1)?.commands;
    expect(commands?.find((command) => command.name === 'documents')).toEqual({
      name: 'documents',
      description: 'Docs',
      displayName: 'Documents',
      brandColor: '#2563EB',
      iconDataUri: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`,
    });
    expect(JSON.stringify(commands)).not.toContain(dir);
  });

  it('drops icons past the shared catalog budget while keeping smaller later ones', () => {
    const dataUri = (length: number): string => `data:image/png;base64,${'A'.repeat(length)}`;
    const commands = [
      { name: 'a', iconDataUri: dataUri(100) },
      { name: 'b', iconDataUri: dataUri(200) },
      { name: 'c', iconDataUri: dataUri(100) },
      { name: 'd' },
    ];

    const capped = capSkillIconPayload(commands, dataUri(100).length * 2 + 50);

    expect(capped.map((command) => [command.name, command.iconDataUri !== undefined])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true],
      ['d', false],
    ]);
  });
});
