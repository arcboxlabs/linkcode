import { AbortError } from 'foxts/abort-error';
import { afterEach, expect, it, vi } from 'vitest';

// Node implements all three, so every case has to hand the module a runtime that doesn't, then put
// the natives back. Held as descriptors because `reason` is an accessor, not a value.
const nativeThrowIfAborted = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'throwIfAborted',
);
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason');
const nativeAbort = Object.getOwnPropertyDescriptor(AbortController.prototype, 'abort');

afterEach(() => {
  if (nativeThrowIfAborted) {
    Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', nativeThrowIfAborted);
  }
  if (nativeReason) Object.defineProperty(AbortSignal.prototype, 'reason', nativeReason);
  if (nativeAbort) Object.defineProperty(AbortController.prototype, 'abort', nativeAbort);
});

/**
 * The module patches at import time behind a `typeof … !== 'function'` guard, so re-running it needs
 * a fresh module registry — there is no exported installer to call.
 */
async function installOnRuntimeWithoutAbortApi(): Promise<void> {
  // @ts-expect-error -- simulate RN's `abort-controller`, which has neither member
  delete AbortSignal.prototype.throwIfAborted;
  // @ts-expect-error -- same as above: the DOM types declare `reason` as always present
  delete AbortSignal.prototype.reason;
  vi.resetModules();
  await import('@mobile/polyfills');
}

it('installs throwIfAborted on a runtime that lacks it (CODE-462)', async () => {
  await installOnRuntimeWithoutAbortApi();

  expect(typeof AbortSignal.prototype.throwIfAborted).toBe('function');
  expect(() => new AbortController().signal.throwIfAborted()).not.toThrow();
});

it('records the reason RN drops and rethrows it verbatim', async () => {
  await installOnRuntimeWithoutAbortApi();

  const controller = new AbortController();
  // Not an Error: `abort()` takes any value, and `ConnectionController` re-throws whatever it gets.
  const reason = { superseded: true };
  controller.abort(reason);

  expect(controller.signal.aborted).toBe(true);
  expect(controller.signal.reason).toBe(reason);

  let thrown: unknown;
  try {
    controller.signal.throwIfAborted();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBe(reason);
});

it('falls back to an AbortError when nothing recorded a reason', async () => {
  await installOnRuntimeWithoutAbortApi();

  const controller = new AbortController();
  controller.abort();

  expect(controller.signal.reason).toBeInstanceOf(AbortError);
  expect(() => controller.signal.throwIfAborted()).toThrow(AbortError);
});

it('leaves a runtime that already has the Abort API untouched', async () => {
  vi.resetModules();
  await import('@mobile/polyfills');

  // Whole descriptors: `toEqual` compares the held functions by reference, and reading `.get` off
  // one would trip @typescript-eslint/unbound-method.
  expect(Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'throwIfAborted')).toEqual(
    nativeThrowIfAborted,
  );
  expect(Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')).toEqual(nativeReason);
  expect(Object.getOwnPropertyDescriptor(AbortController.prototype, 'abort')).toEqual(nativeAbort);
});
