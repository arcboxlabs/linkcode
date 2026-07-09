import type { TranslatorUpstream } from '@linkcode/engine';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidecarChildProcess, SidecarSpawn } from '../ai-gateway';
import { createAiGatewaySidecar, upstreamToToml } from '../ai-gateway';

const upstream: TranslatorUpstream = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-up',
  wire: 'openai-chat',
  model: 'gpt-4.1',
};

class FakeChild implements SidecarChildProcess {
  private readonly dataListeners: Array<(chunk: unknown) => void> = [];
  private readonly exitListeners: Array<(code: number | null) => void> = [];
  readonly stdout = {
    on: (_event: 'data', listener: (chunk: unknown) => void) => this.dataListeners.push(listener),
  };
  readonly stderr = { on: noop };
  killed = false;

  on(event: 'exit' | 'error', listener: (arg: never) => void): void {
    if (event === 'exit') this.exitListeners.push(listener as (code: number | null) => void);
  }
  kill(): void {
    this.killed = true;
  }
  emitStdout(text: string): void {
    for (const listener of this.dataListeners) listener(text);
  }
  emitExit(code: number | null): void {
    for (const listener of this.exitListeners) listener(code);
  }
}

let savedBinary: string | undefined;

beforeEach(() => {
  savedBinary = process.env.LINKCODE_AIGATEWAY_PATH;
  process.env.LINKCODE_AIGATEWAY_PATH = '/fake/aigateway';
});

afterEach(() => {
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
    const sidecar = createAiGatewaySidecar(spawn);
    expect(await sidecar.ensure(upstream)).toBe('http://127.0.0.1:5123');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('reuses a running sidecar for the same upstream', async () => {
    const spawn: SidecarSpawn = vi.fn(() => {
      const child = new FakeChild();
      queueMicrotask(() => child.emitStdout('listening on http://127.0.0.1:5123\n'));
      return child;
    });
    const sidecar = createAiGatewaySidecar(spawn);
    await sidecar.ensure(upstream);
    await sidecar.ensure(upstream);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('rejects when the process exits before listening', async () => {
    const spawn: SidecarSpawn = () => {
      const child = new FakeChild();
      queueMicrotask(() => child.emitExit(1));
      return child;
    };
    await expect(createAiGatewaySidecar(spawn).ensure(upstream)).rejects.toThrow(
      /before listening/,
    );
  });

  it('rejects with a clear error when the binary path is unset', async () => {
    delete process.env.LINKCODE_AIGATEWAY_PATH;
    await expect(createAiGatewaySidecar(() => new FakeChild()).ensure(upstream)).rejects.toThrow(
      /LINKCODE_AIGATEWAY_PATH/,
    );
  });
});
