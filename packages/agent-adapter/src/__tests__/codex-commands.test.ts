import type { AgentEvent, StartOptions } from '@linkcode/schema';
import { describe, expect, it, vi } from 'vitest';
import type { CodexServerHandle } from '../native/codex/adapter';
import { CodexAdapter, codexSkillCommands } from '../native/codex/adapter';
import type { CodexAppServerOptions } from '../native/codex/app-server';

class FakeCodexServer {
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  rejectSkills = false;
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

    await vi.waitFor(() => expect(catalog(events)).toHaveLength(2));
    const refreshed = catalog(events).at(-1);
    expect(refreshed?.commands.map((command) => command.name)).toEqual(['compact', 'new']);
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
});
