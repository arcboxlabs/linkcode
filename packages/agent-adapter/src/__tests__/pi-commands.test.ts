import type { SourceInfo } from '@earendil-works/pi-coding-agent';
import type { AgentEvent } from '@linkcode/schema';
import { asyncNoop, noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { PiAdapter, piCommandCatalog } from '../native/pi';

function sourceInfo(path: string): SourceInfo {
  return { path, source: 'user', scope: 'user', origin: 'top-level' };
}

const sdkMock = vi.hoisted(() => ({
  skills: [] as Array<{ name: string; description: string; disableModelInvocation?: boolean }>,
  prompts: [] as Array<{ name: string; description: string; argumentHint?: string }>,
  // Bare vi.fn(): the adapter awaits its (undefined) result, which is fine for these drives.
  prompt: vi.fn(),
  isStreaming: false,
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: () =>
    Promise.resolve({
      session: {
        get isStreaming() {
          return sdkMock.isStreaming;
        },
        sessionId: 'sess-1',
        model: undefined,
        thinkingLevel: 'medium',
        prompt: sdkMock.prompt,
        abort: asyncNoop,
        dispose: noop,
        bindExtensions: asyncNoop,
        subscribe: () => noop,
      },
    }),
  AuthStorage: { create: () => ({ setRuntimeApiKey: vi.fn() }) },
  ModelRegistry: {
    create: () => ({
      getAll: () => [],
      getAvailable: () => [{ provider: 'openai', id: 'gpt-test', reasoning: false }],
      find: noop,
      registerProvider: noop,
    }),
    inMemory: () => ({ getAll: () => [] }),
  },
  DefaultResourceLoader: class {
    reload() {
      return Promise.resolve();
    }
    getSkills() {
      return { skills: sdkMock.skills, diagnostics: [] };
    }
    getPrompts() {
      return { prompts: sdkMock.prompts, diagnostics: [] };
    }
  },
}));

function commandCatalogs(events: AgentEvent[]) {
  return events.flatMap((e) => (e.type === 'available-commands-update' ? [e.commands] : []));
}

async function startedAdapter() {
  const adapter = new PiAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.start({ kind: 'pi', cwd: '/tmp/pi-test' });
  return { adapter, events };
}

describe('piCommandCatalog', () => {
  it('maps prompt templates by name and skills as skill:<name>', () => {
    const commands = piCommandCatalog({
      getSkills: () => ({
        skills: [
          {
            name: 'brave-search',
            description: 'Web search',
            filePath: '/s/SKILL.md',
            baseDir: '/s',
            sourceInfo: sourceInfo('/s/SKILL.md'),
            disableModelInvocation: false,
          },
          {
            // User-invoke-only skills stay listed — the slash menu is their ONLY entry point.
            name: 'hidden',
            description: 'Hidden from the model',
            filePath: '/h/SKILL.md',
            baseDir: '/h',
            sourceInfo: sourceInfo('/h/SKILL.md'),
            disableModelInvocation: true,
          },
        ],
        diagnostics: [],
      }),
      getPrompts: () => ({
        prompts: [
          {
            name: 'review',
            description: 'Review changes',
            argumentHint: '<target>',
            content: '...',
            sourceInfo: sourceInfo('/p/review.md'),
            filePath: '/p/review.md',
          },
          {
            name: 'bare',
            description: '',
            content: '...',
            sourceInfo: sourceInfo('/p/bare.md'),
            filePath: '/p/bare.md',
          },
        ],
        diagnostics: [],
      }),
    });
    expect(commands).toEqual([
      { name: 'review', description: 'Review changes', argumentHint: '<target>' },
      { name: 'bare', description: undefined, argumentHint: undefined },
      { name: 'skill:brave-search', description: 'Web search' },
      { name: 'skill:hidden', description: 'Hidden from the model' },
    ]);
  });
});

describe('pi slash commands', () => {
  it('advertises the catalog at start and declares the capability', async () => {
    sdkMock.skills = [{ name: 'pdf', description: 'PDF tools' }];
    sdkMock.prompts = [{ name: 'review', description: 'Review', argumentHint: '<t>' }];
    const { adapter, events } = await startedAdapter();
    expect(adapter.capabilities.slashCommands).toBe(true);
    expect(commandCatalogs(events)).toEqual([
      [
        { name: 'review', description: 'Review', argumentHint: '<t>' },
        { name: 'skill:pdf', description: 'PDF tools' },
      ],
    ]);
  });

  it('emits no catalog when discovery finds nothing', async () => {
    sdkMock.skills = [];
    sdkMock.prompts = [];
    const { events } = await startedAdapter();
    expect(commandCatalogs(events)).toEqual([]);
  });

  it('forwards an invocation as slash text through the prompt path', async () => {
    sdkMock.skills = [{ name: 'pdf', description: 'PDF tools' }];
    sdkMock.prompts = [];
    sdkMock.prompt.mockClear();
    const { adapter, events } = await startedAdapter();
    await adapter.send({ type: 'command', name: 'skill:pdf', arguments: 'extract a.pdf' });
    expect(sdkMock.prompt).toHaveBeenCalledWith('/skill:pdf extract a.pdf', undefined);
    // Turn contract: 'running' must be emitted by the time send() resolves.
    expect(events.at(-1)).toEqual({ type: 'status', status: 'running' });
  });

  it('omits the argument tail when there is none', async () => {
    sdkMock.skills = [{ name: 'pdf', description: 'PDF tools' }];
    sdkMock.prompts = [];
    sdkMock.prompt.mockClear();
    const { adapter } = await startedAdapter();
    await adapter.send({ type: 'command', name: 'skill:pdf' });
    expect(sdkMock.prompt).toHaveBeenCalledWith('/skill:pdf', undefined);
  });
});
