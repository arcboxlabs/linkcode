import { noop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeAdapter } from '../native/claude-code';

const sdkMock = vi.hoisted(() => ({
  query: null as ((opts: unknown) => unknown) | null,
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query(opts: unknown) {
    if (!sdkMock.query) throw new Error('query mock not installed');
    return sdkMock.query(opts);
  },
}));

interface QueryInput {
  prompt: AsyncIterable<unknown>;
  options: Record<string, unknown>;
}

/** Vendor `ModelInfo` rows as the CLI's initialize response carries them (runtime shape only). */
interface FakeModelInfo {
  value: string;
  displayName: string;
}

/** Stands in for the SDK's `Query` on the catalog path: `supportedModels()` + `close()`. */
class FakeCatalogQuery {
  readonly options: Record<string, unknown>;
  closed = false;

  constructor(
    input: QueryInput,
    private readonly models: Promise<FakeModelInfo[]>,
  ) {
    this.options = input.options;
  }

  supportedModels(): Promise<FakeModelInfo[]> {
    return this.models;
  }

  close(): void {
    this.closed = true;
  }
}

let lastQuery: FakeCatalogQuery | null = null;

function installCatalog(models: Promise<FakeModelInfo[]>): void {
  sdkMock.query = (opts) => {
    lastQuery = new FakeCatalogQuery(opts as QueryInput, models);
    return lastQuery;
  };
}

afterEach(() => {
  lastQuery = null;
  sdkMock.query = null;
  vi.useRealTimers();
});

describe('claude-code listModels', () => {
  it('maps the initialize catalog to model options and closes the transient query', async () => {
    installCatalog(
      Promise.resolve([
        { value: 'claude-opus-4-8', displayName: 'Opus 4.8' },
        { value: 'claude-sonnet-5', displayName: 'Sonnet 5' },
      ]),
    );
    const models = await new ClaudeCodeAdapter().listModels();
    expect(models).toEqual([
      { id: 'claude-opus-4-8', label: 'Opus 4.8' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5' },
    ]);
    expect(lastQuery?.closed).toBe(true);
  });

  it('drops empty ids and falls back to the id for a blank display name', async () => {
    installCatalog(
      Promise.resolve([
        { value: '', displayName: 'Ghost' },
        { value: 'claude-haiku-4-5', displayName: '' },
      ]),
    );
    await expect(new ClaudeCodeAdapter().listModels()).resolves.toEqual([
      { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
    ]);
  });

  it('injects a configured apiKey into the probe env like a session would', async () => {
    installCatalog(Promise.resolve([]));
    await new ClaudeCodeAdapter().listModels({ apiKey: 'sk-test' });
    const env = lastQuery?.options.env as Record<string, string> | undefined;
    expect(env?.ANTHROPIC_API_KEY).toBe('sk-test');
  });

  it('closes the query and rejects when the CLI never answers initialize', async () => {
    vi.useFakeTimers();
    installCatalog(new Promise(noop)); // initialize response never arrives
    const pending = new ClaudeCodeAdapter().listModels();
    const outcome = expect(pending).rejects.toThrow('model catalog probe timed out');
    await vi.advanceTimersByTimeAsync(30000);
    await outcome;
    expect(lastQuery?.closed).toBe(true);
  });
});
