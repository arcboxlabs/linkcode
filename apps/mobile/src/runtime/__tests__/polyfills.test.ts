import { afterEach, expect, it } from 'vitest';
import { installPolyfills } from '../polyfills';

// Held as a property descriptor: a bare method reference trips @typescript-eslint/unbound-method.
const native = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'throwIfAborted');

afterEach(() => {
  if (native) Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', native);
});

it('installs throwIfAborted when the runtime lacks it (Hermes, CODE-466)', () => {
  // @ts-expect-error -- simulate Hermes, which has no throwIfAborted
  delete AbortSignal.prototype.throwIfAborted;
  installPolyfills();

  const fresh = new AbortController();
  expect(() => fresh.signal.throwIfAborted()).not.toThrow();

  const aborted = new AbortController();
  const reason = new Error('stop');
  aborted.abort(reason);
  expect(() => aborted.signal.throwIfAborted()).toThrow(reason);
});

it('falls back to an AbortError when the signal was aborted without a reason', () => {
  // @ts-expect-error -- simulate Hermes, which has no throwIfAborted
  delete AbortSignal.prototype.throwIfAborted;
  installPolyfills();

  const controller = new AbortController();
  controller.abort();
  // Node fills in an AbortError reason. RN 0.86's `abort-controller` has no `reason` at all, which
  // is the case the fallback exists for, so strip it to reach that branch.
  Object.defineProperty(controller.signal, 'reason', { value: undefined });

  let thrown: unknown;
  try {
    controller.signal.throwIfAborted();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DOMException);
  expect((thrown as DOMException).name).toBe('AbortError');
  // Node's own reason reads "This operation was aborted", so the wording pins the fallback branch.
  expect((thrown as DOMException).message).toBe('The operation was aborted.');
});

it('leaves a native implementation in place', () => {
  installPolyfills();
  expect(Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'throwIfAborted')?.value).toBe(
    native?.value,
  );
});
