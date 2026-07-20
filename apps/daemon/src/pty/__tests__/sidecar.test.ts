import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT, encodeDataFrame, OPENED, OUTPUT } from '../codec';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
}));

async function tick(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function frame(type: number, body: Buffer): Buffer {
  const header = Buffer.allocUnsafe(5);
  header.writeUInt32LE(body.length + 1, 0);
  header[4] = type;
  return Buffer.concat([header, body]);
}

function fakeChild(): PassThrough & {
  stdin: PassThrough;
  stdout: PassThrough;
  kill: ReturnType<typeof vi.fn>;
} {
  const child = new PassThrough() as PassThrough & {
    stdin: PassThrough;
    stdout: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.kill = vi.fn(() => {
    child.emit('exit', null, null);
    return true;
  });
  return child;
}

function platformed<T>(platform: NodeJS.Platform, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return run();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

/** Decode the OPEN frame the backend just wrote to the sidecar's stdin. */
function writtenOpenBody(child: ReturnType<typeof fakeChild>): { cmd: string; args: string[] } {
  const written = child.stdin.read() as Buffer;
  return JSON.parse(written.subarray(5).toString('utf8'));
}

describe('SidecarPtyBackend', () => {
  beforeEach(() => {
    mocks.spawn.mockReset();
  });

  it('rejects an open with an unconfigured binary path instead of spawning it', async () => {
    const { SidecarPtyBackend } = await import('../sidecar');
    const backend = new SidecarPtyBackend('');

    await expect(backend.open('term-1', { cols: 80, rows: 24 })).rejects.toThrow(
      'pty sidecar not configured',
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('rejects duplicate terminal ids while an open is pending', async () => {
    const { SidecarPtyBackend } = await import('../sidecar');
    const child = fakeChild();
    mocks.spawn.mockReturnValueOnce(child);
    const backend = new SidecarPtyBackend('/bin/linkcode-pty');

    const first = backend.open('term-1', { cols: 80, rows: 24 });

    await expect(backend.open('term-1', { cols: 80, rows: 24 })).rejects.toThrow(
      'terminal already exists',
    );
    backend.shutdown();
    await expect(first).rejects.toThrow('pty backend shutdown');
  });

  it('rejects pending opens during shutdown', async () => {
    const { SidecarPtyBackend } = await import('../sidecar');
    const child = fakeChild();
    mocks.spawn.mockReturnValueOnce(child);
    const backend = new SidecarPtyBackend('/bin/linkcode-pty');

    const pending = backend.open('term-1', { cols: 80, rows: 24 });
    backend.shutdown();

    await expect(pending).rejects.toThrow('pty backend shutdown');
  });

  it('rejects opens after shutdown without spawning a new sidecar', async () => {
    const { SidecarPtyBackend } = await import('../sidecar');
    const backend = new SidecarPtyBackend('/bin/linkcode-pty');
    backend.shutdown();

    await expect(backend.open('term-1', { cols: 80, rows: 24 })).rejects.toThrow(
      'pty backend shutdown',
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('rejects a pending open the sidecar never answers, after the open timeout', async () => {
    vi.useFakeTimers();
    try {
      const { SidecarPtyBackend } = await import('../sidecar');
      const child = fakeChild();
      mocks.spawn.mockReturnValueOnce(child);
      const backend = new SidecarPtyBackend('/bin/linkcode-pty');

      // No OPENED/ERROR ever comes back (e.g. an OPEN whose terminalId the sidecar couldn't parse
      // to reply ERROR against) — the open must not hang forever.
      const pending = backend.open('term-1', { cols: 80, rows: 24 });
      const rejection = expect(pending).rejects.toThrow('pty open timed out');
      await vi.advanceTimersByTimeAsync(10000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts the default shell as a login shell on macOS only', async () => {
    const { SidecarPtyBackend } = await import('../sidecar');
    const child = fakeChild();
    mocks.spawn.mockReturnValueOnce(child);
    const backend = new SidecarPtyBackend('/bin/linkcode-pty');

    const darwinOpen = platformed('darwin', () => backend.open('term-1', { cols: 80, rows: 24 }));
    expect(writtenOpenBody(child).args).toEqual(['-l']);
    const linuxOpen = platformed('linux', () => backend.open('term-2', { cols: 80, rows: 24 }));
    expect(writtenOpenBody(child).args).toEqual([]);

    backend.shutdown();
    await expect(darwinOpen).rejects.toThrow('pty backend shutdown');
    await expect(linuxOpen).rejects.toThrow('pty backend shutdown');
  });

  it('never adds login args to an explicitly requested shell', async () => {
    const { SidecarPtyBackend } = await import('../sidecar');
    const child = fakeChild();
    mocks.spawn.mockReturnValueOnce(child);
    const backend = new SidecarPtyBackend('/bin/linkcode-pty');

    const pending = platformed('darwin', () =>
      backend.open('term-1', { cols: 80, rows: 24, shell: '/bin/sh' }),
    );
    expect(writtenOpenBody(child)).toMatchObject({ cmd: '/bin/sh', args: [] });

    backend.shutdown();
    await expect(pending).rejects.toThrow('pty backend shutdown');
  });

  it('buffers output and exit frames received before open subscribers attach', async () => {
    const { SidecarPtyBackend } = await import('../sidecar');
    const child = fakeChild();
    mocks.spawn.mockReturnValueOnce(child);
    const backend = new SidecarPtyBackend('/bin/linkcode-pty');

    const opened = backend.open('term-1', { cols: 80, rows: 24 });
    child.stdout.write(
      Buffer.concat([
        frame(OPENED, Buffer.from(JSON.stringify({ terminalId: 'term-1' }))),
        frame(OUTPUT, encodeDataFrame('term-1', Buffer.from('ready\r\n'))),
        frame(EXIT, Buffer.from(JSON.stringify({ terminalId: 'term-1', exitCode: 7 }))),
      ]),
    );
    const terminal = await opened;
    const output: string[] = [];
    const exits: Array<number | null> = [];

    terminal.onData((data) => output.push(data));
    terminal.onExit((exitCode) => exits.push(exitCode));

    expect(output).toEqual(['ready\r\n']);
    expect(exits).toEqual([7]);
  });

  it('kills the sidecar and exits live terminals after a malformed frame', async () => {
    const { SidecarPtyBackend } = await import('../sidecar');
    const child = fakeChild();
    mocks.spawn.mockReturnValueOnce(child);
    const backend = new SidecarPtyBackend('/bin/linkcode-pty');

    const opened = backend.open('term-1', { cols: 80, rows: 24 });
    child.stdout.write(frame(OPENED, Buffer.from(JSON.stringify({ terminalId: 'term-1' }))));
    const terminal = await opened;
    const exits: Array<number | null> = [];
    terminal.onExit((exitCode) => exits.push(exitCode));

    child.stdout.write(Buffer.alloc(5));
    await tick();

    expect(child.kill).toHaveBeenCalledOnce();
    expect(exits).toEqual([null]);
  });
});
