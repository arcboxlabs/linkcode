/**
 * Runtime gaps in Hermes that shared code relies on. Imported first from the root layout so
 * everything below the app entry sees the patched globals.
 *
 * `AbortSignal#throwIfAborted`: the Abort API comes from RN, not Hermes — RN 0.86 injects the 2019
 * `abort-controller` package, which lacks the method and drops `abort(reason)`, and Expo's winter
 * runtime fills in only the `timeout`/`any` statics. `foxts/async-retry` calls it on entry, which
 * made every `ConnectionController` recovery attempt throw synchronously before dialing — the app
 * could never reach a host (CODE-466). RN 0.87 ships a real implementation, which the guard defers
 * to; CODE-477 deletes this file on the Expo SDK 58 bump.
 */
export function installPolyfills(): void {
  if (!AbortSignal.prototype.throwIfAborted) {
    AbortSignal.prototype.throwIfAborted = function throwIfAborted(this: AbortSignal): void {
      if (this.aborted) {
        // RN 0.86 never populates `reason`, so the fallback is the live path there; it mirrors the
        // shape Expo's winter runtime falls back to, so callers only ever see an `AbortError`.
        throw this.reason ?? new DOMException('The operation was aborted.', 'AbortError');
      }
    };
  }
}

installPolyfills();
