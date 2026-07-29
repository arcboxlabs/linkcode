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

it('throws even when the signal was aborted without a reason', () => {
  // @ts-expect-error -- simulate Hermes, which has no throwIfAborted
  delete AbortSignal.prototype.throwIfAborted;
  installPolyfills();

  const controller = new AbortController();
  controller.abort();
  // Node fills in an AbortError reason; the polyfill's own fallback covers a runtime that leaves
  // `reason` undefined. Either way the call must throw.
  expect(() => controller.signal.throwIfAborted()).toThrow();
});

it('leaves a native implementation in place', () => {
  installPolyfills();
  expect(Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'throwIfAborted')?.value).toBe(
    native?.value,
  );
});
