import type { SessionId } from '@linkcode/schema';
import { Effect } from 'effect';
import { asyncNoop, noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorBackend, SimulatorDeviceInfo } from '../simulator/backend';
import { SimulatorService } from '../simulator/service';

const S1 = 'session-1' as SessionId;
const S2 = 'session-2' as SessionId;

function device(udid: string, state: string): SimulatorDeviceInfo {
  return {
    udid,
    name: `iPhone ${udid}`,
    state,
    runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
    deviceType: null,
  };
}

function fakeBackend(devices: SimulatorDeviceInfo[]) {
  return {
    probe: vi.fn(() => Promise.resolve({ simctlPath: '/usr/bin/simctl', developerDir: '/dev' })),
    list: vi.fn(() => Promise.resolve(devices)),
    boot: vi.fn(asyncNoop),
    shutdownDevice: vi.fn(asyncNoop),
    install: vi.fn(asyncNoop),
    launch: vi.fn(() => Promise.resolve<number | null>(42)),
    terminate: vi.fn(asyncNoop),
    openUrl: vi.fn(asyncNoop),
    screenshot: vi.fn(() => Promise.resolve(new Uint8Array([0xff, 0xd8]))),
    screenMask: vi.fn(() => Promise.resolve(new Uint8Array([0x89, 0x50]))),
    tap: vi.fn(asyncNoop),
    swipe: vi.fn(asyncNoop),
    button: vi.fn(asyncNoop),
    streamStart: vi.fn(() =>
      Promise.resolve<Awaited<ReturnType<SimulatorBackend['streamStart']>>>({
        streaming: true,
        fps: 60,
        scale: 1,
      }),
    ),
    streamStop: vi.fn(asyncNoop),
    onFrame: vi.fn(() => noop),
    close: vi.fn(noop),
  } satisfies SimulatorBackend;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SimulatorService', () => {
  it('claims a device for the booting session and rejects other sessions', async () => {
    const backend = fakeBackend([device('A', 'Shutdown')]);
    const service = new SimulatorService(backend);

    await service.boot(S1, 'A');
    expect(backend.boot).toHaveBeenCalledWith('A');
    expect(service.ownerOf('A')).toBe(S1);

    await expect(service.launch(S2, 'A', 'com.example')).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(service.launch(S1, 'A', 'com.example')).resolves.toBe(42);
  });

  it('caps a session at four devices', async () => {
    const backend = fakeBackend([]);
    const service = new SimulatorService(backend);

    for (const udid of ['A', 'B', 'C', 'D']) {
      await service.openUrl(S1, udid, 'https://example.com');
    }
    await expect(service.openUrl(S1, 'E', 'https://example.com')).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
    await expect(service.openUrl(S2, 'E', 'https://example.com')).resolves.toBeUndefined();
  });

  it('reclaims a service-booted device after the idle window', async () => {
    const backend = fakeBackend([device('A', 'Shutdown')]);
    const service = new SimulatorService(backend, { idleReclaimMs: 1000 });

    await service.boot(S1, 'A');
    service.releaseSession(S1);
    // Still reserved during the window: another session cannot take it over.
    await expect(service.launch(S2, 'A', 'com.example')).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(backend.shutdownDevice).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.shutdownDevice).toHaveBeenCalledWith('A');
    expect(service.ownerOf('A')).toBeUndefined();
  });

  it('keeps the device when its session comes back within the window', async () => {
    const backend = fakeBackend([device('A', 'Shutdown')]);
    const service = new SimulatorService(backend, { idleReclaimMs: 1000 });

    await service.boot(S1, 'A');
    service.releaseSession(S1);
    await service.screenshot(S1, 'A');

    await vi.advanceTimersByTimeAsync(5000);
    expect(backend.shutdownDevice).not.toHaveBeenCalled();
    expect(service.ownerOf('A')).toBe(S1);
  });

  it('never shuts down a device the user booted', async () => {
    const backend = fakeBackend([device('A', 'Booted')]);
    const service = new SimulatorService(backend, { idleReclaimMs: 1000 });

    await service.boot(S1, 'A');
    expect(backend.boot).not.toHaveBeenCalled();
    service.releaseSession(S1);
    // Released immediately — no reservation window for a device that isn't ours to reclaim.
    expect(service.ownerOf('A')).toBeUndefined();

    await vi.advanceTimersByTimeAsync(5000);
    expect(backend.shutdownDevice).not.toHaveBeenCalled();
  });

  it('shuts service-booted devices down and closes the backend on engine shutdown', async () => {
    const backend = fakeBackend([device('A', 'Shutdown'), device('B', 'Booted')]);
    const service = new SimulatorService(backend);

    await service.boot(S1, 'A');
    await service.boot(S2, 'B');
    await Effect.runPromise(service.shutdown());

    expect(backend.shutdownDevice).toHaveBeenCalledTimes(1);
    expect(backend.shutdownDevice).toHaveBeenCalledWith('A');
    expect(backend.close).toHaveBeenCalledTimes(1);
  });

  it('reclaims a service-booted device whose session stops mid-boot', async () => {
    const backend = fakeBackend([device('A', 'Shutdown')]);
    let resolveBoot!: () => void;
    backend.boot.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveBoot = resolve;
        }),
    );
    const service = new SimulatorService(backend, { idleReclaimMs: 1000 });

    const booting = service.boot(S1, 'A');
    // Let boot() claim the device and reach the (still-pending) backend.boot() call.
    await vi.advanceTimersByTimeAsync(0);
    // The owning session stops before the boot finishes, dropping the not-yet-service-booted claim.
    service.releaseSession(S1);
    resolveBoot();
    await booting;

    // The device we booted must not be left running untracked: it is re-tracked for reclaim, so it
    // is not shut down immediately but is once the idle window elapses (without the fix there is no
    // claim, so the booted device is never reclaimed).
    expect(backend.shutdownDevice).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.shutdownDevice).toHaveBeenCalledWith('A');
    expect(service.ownerOf('A')).toBeUndefined();
  });

  it('holds the claim until the reclaim shutdown settles', async () => {
    const backend = fakeBackend([device('A', 'Shutdown')]);
    let resolveShutdown!: () => void;
    backend.shutdownDevice.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveShutdown = resolve;
        }),
    );
    const service = new SimulatorService(backend, { idleReclaimMs: 1000 });

    await service.boot(S1, 'A');
    service.releaseSession(S1);
    await vi.advanceTimersByTimeAsync(1000); // idle timer fires → shutdown in flight
    expect(backend.shutdownDevice).toHaveBeenCalledWith('A');
    // Another session must not grab the udid while its shutdown is still running.
    await expect(service.openUrl(S2, 'A', 'https://example.com')).rejects.toMatchObject({
      code: 'conflict',
    });
    // The device frees only once the shutdown settles.
    resolveShutdown();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.ownerOf('A')).toBeUndefined();
  });

  it('keeps ownership when the session resumes during the reclaim shutdown', async () => {
    const backend = fakeBackend([device('A', 'Shutdown')]);
    let resolveShutdown!: () => void;
    backend.shutdownDevice.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveShutdown = resolve;
        }),
    );
    const service = new SimulatorService(backend, { idleReclaimMs: 1000 });

    await service.boot(S1, 'A');
    service.releaseSession(S1);
    await vi.advanceTimersByTimeAsync(1000); // idle timer fires → shutdown in flight
    // The owning session comes back while the reclaim shutdown is still settling.
    await service.screenshot(S1, 'A');
    resolveShutdown();
    await vi.advanceTimersByTimeAsync(0);
    // The resumed session keeps the device; the settling shutdown must not drop its re-claim.
    expect(service.ownerOf('A')).toBe(S1);
  });

  it('rejects operations from a session the engine does not know', async () => {
    const backend = fakeBackend([device('A', 'Shutdown')]);
    const service = new SimulatorService(backend, { hasSession: (id) => id === S1 });

    await expect(service.boot(S2, 'A')).rejects.toMatchObject({ code: 'not_found' });
    // A rejected fabricated session must not leave a claim behind (it never gets a session-stop).
    expect(service.ownerOf('A')).toBeUndefined();
    await expect(service.boot(S1, 'A')).resolves.toBeUndefined();
  });

  it('rolls back a claim the failed command created', async () => {
    const backend = fakeBackend([device('A', 'Shutdown')]);
    backend.openUrl.mockRejectedValueOnce(new Error('boom'));
    const service = new SimulatorService(backend);

    await expect(service.openUrl(S1, 'A', 'https://example.com')).rejects.toThrow('boom');
    // The failed command never acquired the device, so it is free for another session.
    expect(service.ownerOf('A')).toBeUndefined();
    await expect(service.openUrl(S2, 'A', 'https://example.com')).resolves.toBeUndefined();
  });

  it('keeps a pre-existing claim when a later command fails', async () => {
    const backend = fakeBackend([device('A', 'Shutdown')]);
    const service = new SimulatorService(backend);

    await service.boot(S1, 'A');
    backend.openUrl.mockRejectedValueOnce(new Error('boom'));
    await expect(service.openUrl(S1, 'A', 'https://example.com')).rejects.toThrow('boom');
    // The claim pre-existed this command, so its failure must not release S1's device.
    expect(service.ownerOf('A')).toBe(S1);
  });

  it('frees a device on owner-driven shutdown', async () => {
    const backend = fakeBackend([device('A', 'Shutdown')]);
    const service = new SimulatorService(backend);

    await service.boot(S1, 'A');
    await service.shutdownDevice(S1, 'A');
    expect(service.ownerOf('A')).toBeUndefined();
    // Freed for anyone: a different session can claim it next.
    await expect(service.openUrl(S2, 'A', 'https://example.com')).resolves.toBeUndefined();
  });
});
