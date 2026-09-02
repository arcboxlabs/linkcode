import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TranslatorUpstream } from '@linkcode/engine';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidecarChildProcess, SidecarSpawn } from '../ai-gateway';
import { createAiGatewaySidecar, upstreamToToml } from '../ai-gateway';

const EXIT_BEFORE_LISTENING_RE = /before listening/;
const FAILED_TO_START_RE = /failed to start.*ENOENT/;
const NO_BINARY_RE = /no aigateway binary/;
const STARTUP_TIMEOUT_RE = /did not become ready/;
const STOPPED_BEFORE_LISTENING_RE = /stopped before listening/;

function configDir(path: string | undefined): string {
  return dirname(nullthrow(path, 'spawn did not receive a config path'));
}

const upstream: TranslatorUpstream = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-up',
  wire: 'openai-chat',
  model: 'gpt-4.1',
};

class FakeChild implements SidecarChildProcess {
  private readonly dataListeners: Array<(chunk: unknown) => void> = [];
  private readonly errorListeners: Array<(error: Error) => void> = [];
  private readonly exitListeners: Array<(code: number | null) => void> = [];
  readonly stdout = {
    on: (_event: 'data', listener: (chunk: unknown) => void) => this.dataListeners.push(listener),
  };
  readonly stderr = { on: noop };
  killed = false;
  signal: NodeJS.Signals | undefined;

  on(event: 'exit' | 'error', listener: (arg: never) => void): void {
    if (event === 'exit') {
      this.exitListeners.push(listener as (code: number | null) => void);
    } else {
      this.errorListeners.push(listener as (error: Error) => void);
    }
  }
  kill(signal?: NodeJS.Signals): void {
    this.killed = true;
    this.signal = signal;
  }
  emitStdout(text: string): void {
    for (let i = 0, len = this.dataListeners.length; i < len; i++) {
      const listener = this.dataListeners[i];
      listener(text);
    }
  }
  emitError(error: Error): void {
    for (let i = 0, len = this.errorListeners.length; i < len; i++) {
      const listener = this.errorListeners[i];
      listener(error);
    }
  }
  emitExit(code: number | null): void {
    for (let i = 0, len = this.exitListeners.length; i < len; i++) {
      const listener = this.exitListeners[i];
      listener(code);
    }
  }
}

let savedBinary: string | undefined;

beforeEach(() => {
  savedBinary = process.env.LINKCODE_AIGATEWAY_PATH;
  process.env.LINKCODE_AIGATEWAY_PATH = '/fake/aigateway';
});

afterEach(() => {
  vi.useRealTimers();
  if (savedBinary === undefined) delete process.env.LINKCODE_AIGATEWAY_PATH;
  else process.env.LINKCODE_AIGATEWAY_PATH = savedBinary;
});

describe('upstreamToToml', () => {
  it('serializes the upstream fields, quoting strings', () => {
    expect(upstreamToToml(upstream)).toBe(
      '[upstream]\n' +
        'base_url = "https://api.openai.com/v1"\n' +
        'api_key = "sk-up"\n' +
        'wire = "openai-chat"\n' +
        'default_model = "gpt-4.1"\n',
    );
  });

  it('omits default_model when no model is set', () => {
    expect(upstreamToToml({ ...upstream, model: undefined })).not.toContain('default_model');
  });
});

describe('createAiGatewaySidecar', () => {
  it('spawns aigateway and resolves the listening URL', async () => {
    const spawn: SidecarSpawn = vi.fn(() => {
      const child = new FakeChild();
      queueMicrotask(() => child.emitStdout('listening on http://127.0.0.1:5123\n'));
      return child;
    });
    const sidecar = createAiGatewaySidecar({ spawn });
    expect(await sidecar.ensure(upstream)).toBe('http://127.0.0.1:5123');
    expect(spawn).toHaveBeenCalledTimes(1);
    await sidecar.closeAll();
  });

  it('reuses a running sidecar for the same upstream', async () => {
    const spawn: SidecarSpawn = vi.fn(() => {
      const child = new FakeChild();
      queueMicrotask(() => child.emitStdout('listening on http://127.0.0.1:5123\n'));
      return child;
    });
    const sidecar = createAiGatewaySidecar({ spawn });
    await sidecar.ensure(upstream);
    await sidecar.ensure(upstream);
    expect(spawn).toHaveBeenCalledTimes(1);
    await sidecar.closeAll();
  });

  it('rejects when the process exits before listening', async () => {
    const spawn: SidecarSpawn = () => {
      const child = new FakeChild();
      queueMicrotask(() => child.emitExit(1));
      return child;
    };
    await expect(createAiGatewaySidecar({ spawn }).ensure(upstream)).rejects.toThrow(
      EXIT_BEFORE_LISTENING_RE,
    );
  });

  it('installs the binary on demand when the env override is unset', async () => {
    delete process.env.LINKCODE_AIGATEWAY_PATH;
    const spawn: SidecarSpawn = vi.fn(() => {
      const child = new FakeChild();
      queueMicrotask(() => child.emitStdout('listening on http://127.0.0.1:5123\n'));
      return child;
    });
    const ensureBinary = vi.fn(() => Promise.resolve('/managed/aigateway'));
    const sidecar = createAiGatewaySidecar({ spawn, ensureBinary });
    expect(await sidecar.ensure(upstream)).toBe('http://127.0.0.1:5123');
    expect(ensureBinary).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith('/managed/aigateway', expect.any(Array));
    await sidecar.closeAll();
  });

  it('rejects with a clear error when no binary is available', async () => {
    delete process.env.LINKCODE_AIGATEWAY_PATH;
    await expect(
      createAiGatewaySidecar({ spawn: () => new FakeChild() }).ensure(upstream),
    ).rejects.toThrow(NO_BINARY_RE);
  });

  it('cleans temporary credentials when spawn emits an error', async () => {
    let configPath: string | undefined;
    const spawn: SidecarSpawn = (_command, args) => {
      configPath = args.at(-1);
      const child = new FakeChild();
      queueMicrotask(() => child.emitError(new Error('spawn aigateway ENOENT')));
      return child;
    };

    await expect(createAiGatewaySidecar({ spawn }).ensure(upstream)).rejects.toThrow(
      FAILED_TO_START_RE,
    );
    expect(existsSync(configDir(configPath))).toBe(false);
  });

  it('terminates and cleans a sidecar that misses the readiness deadline', async () => {
    vi.useFakeTimers();
    let configPath: string | undefined;
    const child = new FakeChild();
    const spawn: SidecarSpawn = (_command, args) => {
      configPath = args.at(-1);
      return child;
    };
    const pending = createAiGatewaySidecar({ spawn }).ensure(upstream);
    const rejection = expect(pending).rejects.toThrow(STARTUP_TIMEOUT_RE);

    await vi.advanceTimersByTimeAsync(10000);

    expect(child.killed).toBe(true);
    expect(child.signal).toBe('SIGTERM');
    expect(existsSync(configDir(configPath))).toBe(false);
    await rejection;
  });

  it('terminates and cleans a sidecar before waiting for startup during shutdown', async () => {
    let configPath: string | undefined;
    const child = new FakeChild();
    const spawn: SidecarSpawn = (_command, args) => {
      configPath = args.at(-1);
      return child;
    };
    const sidecar = createAiGatewaySidecar({ spawn });
    const pending = sidecar.ensure(upstream);

    const rejection = expect(pending).rejects.toThrow(STOPPED_BEFORE_LISTENING_RE);
    await sidecar.closeAll();

    await rejection;
    expect(child.killed).toBe(true);
    expect(child.signal).toBe('SIGTERM');
    expect(existsSync(configDir(configPath))).toBe(false);
  });
});
