import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SimSidecarClient, SimSidecarError } from '../client';
import { REQUEST, SCREENSHOT, STREAM_FRAME } from '../codec';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
}));

function frame(type: number, body: Buffer): Buffer {
  const header = Buffer.allocUnsafe(5);
  header.writeUInt32LE(body.length + 1, 0);
  header[4] = type;
  return Buffer.concat([header, body]);
}

function resultFrame(payload: unknown): Buffer {
  return frame(0x81, Buffer.from(JSON.stringify(payload)));
}

function streamFrameBytes(type: number, udid: string, image: number[]): Buffer {
  const u = Buffer.from(udid);
  return frame(type, Buffer.concat([Buffer.from([u.length, 0]), u, Buffer.from(image)]));
}

type FakeChild = PassThrough & {
  stdin: PassThrough;
  stdout: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(): FakeChild {
  const child = new PassThrough() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.kill = vi.fn(() => {
    child.emit('exit', null, null);
    return true;
  });
  return child;
}

/** Read the next REQUEST frame the client wrote to the fake child's stdin. */
function readRequest(child: FakeChild): { requestId: string; op: { type: string } } {
  const chunk = child.stdin.read() as Buffer;
  expect(chunk.readUInt32LE(0)).toBe(chunk.length - 4);
  expect(chunk[4]).toBe(REQUEST);
  return JSON.parse(chunk.subarray(5).toString('utf8')) as {
    requestId: string;
    op: { type: string };
  };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

beforeEach(() => {
  mocks.spawn.mockReset();
});

describe('SimSidecarClient', () => {
  it('resolves a request from its RESULT frame by id', async () => {
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const client = new SimSidecarClient('/bin/sim');

    const probing = client.probe();
    await tick();
    const request = readRequest(child);
    expect(request.op.type).toBe('probe');

    child.stdout.write(
      resultFrame({
        requestId: request.requestId,
        ok: true,
        result: { simctlPath: '/usr/bin/simctl', developerDir: '/dev/dir' },
      }),
    );
    await expect(probing).resolves.toEqual({
      simctlPath: '/usr/bin/simctl',
      developerDir: '/dev/dir',
    });
  });

  it('rejects with the sidecar error code', async () => {
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const client = new SimSidecarClient('/bin/sim');

    const booting = client.boot('U-1');
    await tick();
    const request = readRequest(child);
    child.stdout.write(
      resultFrame({
        requestId: request.requestId,
        ok: false,
        error: { code: 'xcodeMissing', message: 'no xcode' },
      }),
    );
    await expect(booting).rejects.toMatchObject(new SimSidecarError('xcodeMissing', 'no xcode'));
  });

  it('resolves screenshots from the binary frame', async () => {
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const client = new SimSidecarClient('/bin/sim');

    const shooting = client.screenshot('U-1');
    await tick();
    const request = readRequest(child);
    const id = Buffer.from(request.requestId);
    child.stdout.write(
      frame(
        SCREENSHOT,
        Buffer.concat([Buffer.from([id.length, 0]), id, Buffer.from([0xff, 0xd8, 0x01])]),
      ),
    );
    await expect(shooting).resolves.toEqual(Buffer.from([0xff, 0xd8, 0x01]));
  });

  it('fails every pending request when the sidecar dies, then respawns on the next call', async () => {
    const first = fakeChild();
    const second = fakeChild();
    mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const client = new SimSidecarClient('/bin/sim');

    const doomed = client.list();
    await tick();
    first.emit('exit', 1, null);
    await expect(doomed).rejects.toThrow('sim sidecar exited');

    const retried = client.list();
    await tick();
    const request = readRequest(second);
    second.stdout.write(
      resultFrame({ requestId: request.requestId, ok: true, result: { devices: [] } }),
    );
    await expect(retried).resolves.toEqual([]);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });

  it('sends interactive coordinates as JSON numbers', async () => {
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const client = new SimSidecarClient('/bin/sim');

    void client.tap('U-1', 0.25, 0.5);
    await tick();
    const chunk = child.stdin.read() as Buffer;
    const request = JSON.parse(chunk.subarray(5).toString('utf8')) as {
      op: { type: string; x: unknown; y: unknown };
    };
    expect(request.op).toMatchObject({ type: 'tap', x: 0.25, y: 0.5 });
    expect(typeof request.op.x).toBe('number');
  });

  it('fans STREAM_FRAMEs out to per-udid listeners until unsubscribed', async () => {
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const client = new SimSidecarClient('/bin/sim');
    // Touch the child so the sidecar's stdout is wired up.
    void client.streamStart('U-1');
    await tick();

    const seen: Buffer[] = [];
    const unsubscribe = client.onFrame('U-1', (image) => seen.push(image));

    child.stdout.write(streamFrameBytes(STREAM_FRAME, 'U-1', [0xff, 0xd8, 0x01]));
    child.stdout.write(streamFrameBytes(STREAM_FRAME, 'U-2', [0x00])); // other device: ignored
    await tick();
    expect(seen.map((b) => [...b])).toEqual([[0xff, 0xd8, 0x01]]);

    unsubscribe();
    child.stdout.write(streamFrameBytes(STREAM_FRAME, 'U-1', [0x02]));
    await tick();
    expect(seen).toHaveLength(1);
  });

  it('rejects calls without a configured binary and after close', async () => {
    const unconfigured = new SimSidecarClient('');
    await expect(unconfigured.probe()).rejects.toThrow('sim sidecar not configured');
    expect(mocks.spawn).not.toHaveBeenCalled();

    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const client = new SimSidecarClient('/bin/sim');
    const pending = client.probe();
    await tick();
    client.close();
    await expect(pending).rejects.toThrow('sim client closed');
    await expect(client.probe()).rejects.toThrow('sim client closed');
  });
});
