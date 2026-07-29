import { AbortError } from 'foxts/abort-error';

/**
 * React Native installs `AbortController`/`AbortSignal` from the `abort-controller` npm package
 * (`react-native/Libraries/Core/setUpXHR.js`), a 2019 polyfill that predates two parts of the spec
 * this codebase relies on: `signal.reason` and `signal.throwIfAborted()`.
 *
 * The gap is silent and total. `foxts/async-retry` opens with `options.signal?.throwIfAborted()` —
 * the optional chain guards the *signal*, not the method — so every `asyncRetry` call given a
 * signal threw `TypeError: undefined is not a function` before doing any work. That is the whole
 * of CODE-462: `ConnectionController` passes a signal, so the mobile client never reached the
 * network at all, which reads from the outside exactly like an unreachable host.
 *
 * `reason` is patched alongside it because the two are one feature: `throwIfAborted` is specified
 * to throw `reason`, and our own controller re-throws `signal.reason` when a run is superseded.
 * Left unpatched that throws `undefined`, which no `catch` can classify.
 *
 * Imported for side effects before anything else in the root layout. Native `timeout()`/`any()`
 * signals still resolve, because the throw falls back to a fresh `AbortError` when nothing
 * recorded a reason.
 */

const RECORDED_REASON = Symbol('linkcode.abortReason');

interface ReasonCarrier {
  [RECORDED_REASON]?: unknown;
}

/* eslint-disable sukka/class-prototype -- patching an existing global's prototype is the only
   shape a polyfill can take; there is no class here to declare. */
if (typeof AbortSignal.prototype.throwIfAborted !== 'function') {
  // Capturing the original unbound is the point: it is re-invoked below with an explicit `this`,
  // and binding here would fix it to the prototype rather than the instance doing the aborting.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- see above
  const nativeAbort = AbortController.prototype.abort;

  AbortController.prototype.abort = function abort(this: AbortController, reason?: unknown): void {
    (this.signal as ReasonCarrier)[RECORDED_REASON] = reason ?? new AbortError();
    nativeAbort.call(this);
  };

  Object.defineProperty(AbortSignal.prototype, 'reason', {
    configurable: true,
    get(this: ReasonCarrier): unknown {
      return this[RECORDED_REASON];
    },
  });

  AbortSignal.prototype.throwIfAborted = function throwIfAborted(this: AbortSignal): void {
    if (!this.aborted) return;
    // `abort(reason)` takes any value and `throwIfAborted` is specified to rethrow it verbatim;
    // narrowing to Error here would make the polyfill lie about what the caller aborted with.
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- see above
    throw (this as ReasonCarrier)[RECORDED_REASON] ?? new AbortError();
  };
}
/* eslint-enable sukka/class-prototype */
