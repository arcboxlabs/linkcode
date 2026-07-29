/**
 * Runtime gaps in Hermes that shared code relies on. Imported first from the root layout so
 * everything below the app entry sees the patched globals.
 *
 * `AbortSignal#throwIfAborted`: Hermes ships `AbortSignal.any` but not this method (checked on
 * RN 0.86). `foxts/async-retry` calls it on entry, which made every `ConnectionController`
 * recovery attempt throw synchronously before dialing — the app could never reach a host
 * (CODE-466). The guard keeps a future native implementation in charge once Hermes grows one.
 */
export function installPolyfills(): void {
  if (!AbortSignal.prototype.throwIfAborted) {
    AbortSignal.prototype.throwIfAborted = function throwIfAborted(this: AbortSignal): void {
      if (this.aborted) {
        // Spec: throw the abort reason. An aborted-without-reason signal still must throw.
        throw this.reason ?? new Error('Aborted');
      }
    };
  }
}

installPolyfills();
