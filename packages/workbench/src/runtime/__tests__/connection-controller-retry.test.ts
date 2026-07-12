import { getDefaultClient } from '@linkcode/sdk';
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

describe('WorkbenchConnectionController retry and disposal', () => {
  it('allows another explicit retry after the previous hook settles', async () => {
    vi.useFakeTimers();
    const first = new TestTransport(() => Promise.reject(new Error('down')));
    const second = new TestTransport(() => Promise.reject(new Error('still down')));
    const third = new TestTransport(asyncNoop);
    const nextTransport = transportSequence(first, second, third);
    const onExplicitRetry = vi.fn(asyncNoop);
    const resolve = vi.fn(() => ({ transport: nextTransport() }));
    const controller = testController({ resolve, onExplicitRetry }, { minTimeout: 1000 });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().status).toBe('retrying');

    controller.retry();
    controller.retry();
    await vi.advanceTimersByTimeAsync(0);

    expect(onExplicitRetry).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().status).toBe('retrying');

    controller.retry();
    await vi.advanceTimersByTimeAsync(0);

    expect(onExplicitRetry).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().status).toBe('ready');
    controller.dispose();
  });

  it('deduplicates an explicit-retry hook across source invalidation', async () => {
    vi.useFakeTimers();
    const hookPending = deferred();
    const first = new TestTransport(() => Promise.reject(new Error('down')));
    const second = new TestTransport(() => Promise.reject(new Error('runtime still down')));
    const third = new TestTransport(asyncNoop);
    const nextTransport = transportSequence(first, second, third);
    let invalidate = noop;
    const onExplicitRetry = vi.fn(() => hookPending.promise);
    const controller = testController(
      {
        onExplicitRetry,
        resolve: () => ({ transport: nextTransport() }),
        subscribe(cb) {
          invalidate = cb;
          return noop;
        },
      },
      { minTimeout: 1000 },
    );

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(onExplicitRetry).toHaveBeenCalledOnce();

    invalidate();
    await vi.advanceTimersByTimeAsync(0);
    controller.retry();
    expect(onExplicitRetry).toHaveBeenCalledOnce();

    hookPending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    controller.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(onExplicitRetry).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().status).toBe('ready');
    controller.dispose();
  });

  it('installs the default SDK client only while a ready generation is active', async () => {
    vi.useFakeTimers();
    const firstPending = deferred();
    const secondPending = deferred();
    const first = new TestTransport(() => firstPending.promise);
    const second = new TestTransport(() => secondPending.promise);
    const nextTransport = transportSequence(first, second);
    const controller = testController({ resolve: () => ({ transport: nextTransport() }) });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(() => getDefaultClient()).toThrow('not been initialized');

    firstPending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(getDefaultClient()).toBe(controller.getSnapshot().contextGeneration?.client);

    first.emitClose();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().status).toBe('connecting');
    expect(() => getDefaultClient()).toThrow('not been initialized');
    controller.dispose();
  });

  it('exposes a source failure without inventing a context generation', async () => {
    vi.useFakeTimers();
    const sourceError = new Error('cannot resolve endpoint');
    const controller = testController({
      resolve() {
        throw sourceError;
      },
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.getSnapshot()).toMatchObject({
      contextGeneration: null,
      error: sourceError,
      status: 'error',
    });
    controller.dispose();
  });

  it('surfaces an explicit-retry failure before resuming normal backoff', async () => {
    vi.useFakeTimers();
    const supervisorError = new Error('supervisor restart failed');
    const first = new TestTransport(asyncNoop);
    const second = new TestTransport(asyncNoop);
    const nextTransport = transportSequence(first, second);
    const resolve = vi.fn(() => ({ transport: nextTransport() }));
    const controller = testController(
      {
        resolve,
        onExplicitRetry: () => Promise.reject(supervisorError),
      },
      { minTimeout: 10, maxTimeout: 10 },
    );

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const firstGeneration = controller.getSnapshot().contextGeneration?.id;
    expect(controller.getSnapshot().status).toBe('ready');

    controller.retry();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.getSnapshot()).toMatchObject({
      status: 'retrying',
      error: supervisorError,
      attempt: 1,
    });
    expect(controller.getSnapshot().contextGeneration?.id).toBe(firstGeneration);
    expect(resolve).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().status).toBe('ready');
    controller.dispose();
  });

  it('cancels pending work and ignores late completion after disposal', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const transport = new TestTransport(() => pending.promise);
    const unsubscribe = vi.fn();
    const resolve = vi.fn(() => ({ transport }));
    const controller = testController({ resolve, subscribe: () => unsubscribe });
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.dispose();
    const callsAfterDispose = listener.mock.calls.length;
    pending.resolve();
    await vi.advanceTimersByTimeAsync(10000);

    expect(resolve).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledTimes(callsAfterDispose);
  });
});
