import { asyncNoop, noop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deferred,
  TestTransport,
  testController,
  transportSequence,
} from './connection-controller-test-helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('WorkbenchConnectionController recovery', () => {
  it('recovers an initial failure with a fresh generation', async () => {
    vi.useFakeTimers();
    const failure = new Error('daemon unavailable');
    const first = new TestTransport(() => Promise.reject(failure));
    const second = new TestTransport(asyncNoop);
    const nextTransport = transportSequence(first, second);
    const resolve = vi.fn(() => ({ endpoint: 'http://daemon', transport: nextTransport() }));
    const controller = testController({ resolve }, { minTimeout: 10, maxTimeout: 10 });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.getSnapshot()).toMatchObject({
      status: 'retrying',
      endpoint: 'http://daemon',
      error: failure,
      attempt: 1,
    });
    const firstGeneration = controller.getSnapshot().contextGeneration?.id;
    expect(first.close).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10);

    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', attempt: 2 });
    expect(controller.getSnapshot().contextGeneration?.id).not.toBe(firstGeneration);
    expect(resolve).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('starts a fresh retry loop immediately when a ready connection closes', async () => {
    vi.useFakeTimers();
    const first = new TestTransport(asyncNoop);
    const second = new TestTransport(asyncNoop);
    const nextTransport = transportSequence(first, second);
    const controller = testController({
      resolve: () => ({ endpoint: 'http://daemon', transport: nextTransport() }),
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const firstGeneration = controller.getSnapshot().contextGeneration?.id;
    expect(controller.getSnapshot().status).toBe('ready');

    first.emitClose();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', attempt: 1 });
    expect(controller.getSnapshot().contextGeneration?.id).not.toBe(firstGeneration);
    controller.dispose();
  });

  it('invalidates a connecting generation even when the endpoint is unchanged', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const first = new TestTransport(() => pending.promise);
    const second = new TestTransport(asyncNoop);
    const nextTransport = transportSequence(first, second);
    let invalidate = noop;
    const unsubscribe = vi.fn();
    const controller = testController({
      resolve: () => ({ endpoint: 'http://same-endpoint', transport: nextTransport() }),
      subscribe(cb) {
        invalidate = cb;
        return unsubscribe;
      },
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const firstGeneration = controller.getSnapshot().contextGeneration?.id;

    invalidate();
    await vi.advanceTimersByTimeAsync(0);
    const secondGeneration = controller.getSnapshot().contextGeneration?.id;
    expect(controller.getSnapshot().status).toBe('ready');
    expect(secondGeneration).not.toBe(firstGeneration);
    expect(first.close).toHaveBeenCalledOnce();

    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().contextGeneration?.id).toBe(secondGeneration);

    controller.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('caps exponential retry delays', async () => {
    vi.useFakeTimers();
    const resolve = vi.fn(() => ({
      transport: new TestTransport(() => Promise.reject(new Error('down'))),
    }));
    const controller = testController({ resolve }, { minTimeout: 10, factor: 2, maxTimeout: 25 });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolve).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    expect(resolve).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20);
    expect(resolve).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(25);
    expect(resolve).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(25);
    expect(resolve).toHaveBeenCalledTimes(5);
    controller.dispose();
  });

  it('keeps failed recovery attempts private until one reaches ready', async () => {
    vi.useFakeTimers();
    const first = new TestTransport(asyncNoop);
    const second = new TestTransport(() => Promise.reject(new Error('restart pending')));
    const thirdPending = deferred();
    const third = new TestTransport(() => thirdPending.promise);
    const nextTransport = transportSequence(first, second, third);
    const controller = testController(
      { resolve: () => ({ endpoint: 'http://daemon', transport: nextTransport() }) },
      { minTimeout: 10, maxTimeout: 10 },
    );

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const contextGeneration = controller.getSnapshot().contextGeneration;
    expect(controller.getSnapshot().status).toBe('ready');

    first.emitClose();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot()).toMatchObject({
      contextGeneration,
      status: 'retrying',
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(controller.getSnapshot()).toMatchObject({
      contextGeneration,
      status: 'retrying',
    });
    thirdPending.reject(new Error('still starting'));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot()).toMatchObject({
      contextGeneration,
      status: 'retrying',
    });
    controller.dispose();
  });

  it('publishes a new target endpoint without exposing its failed generation', async () => {
    vi.useFakeTimers();
    const first = new TestTransport(asyncNoop);
    const second = new TestTransport(() => Promise.reject(new Error('new endpoint down')));
    const nextTransport = transportSequence(first, second);
    let endpoint = 'http://daemon-a';
    let invalidate = noop;
    const controller = testController(
      {
        resolve: () => ({ endpoint, transport: nextTransport() }),
        subscribe(cb) {
          invalidate = cb;
          return noop;
        },
      },
      { minTimeout: 1000 },
    );

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const firstGeneration = controller.getSnapshot().contextGeneration;
    expect(firstGeneration?.endpoint).toBe('http://daemon-a');

    endpoint = 'http://daemon-b';
    invalidate();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.getSnapshot()).toMatchObject({
      contextGeneration: firstGeneration,
      endpoint: 'http://daemon-b',
      status: 'retrying',
    });
    controller.dispose();
  });
});
