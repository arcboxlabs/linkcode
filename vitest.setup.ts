/**
 * jsdom gaps that `@pierre/diffs` walks into the moment the chat diff card mounts a `FileDiff`.
 * Applied globally because `setupFiles` runs for every environment; both writes are skipped when
 * the real API exists, so a node-environment test is unaffected.
 *
 * Written through `Reflect`: the DOM lib types both of these as always present, so a plain
 * assignment needs a force cast (banned) and `??=` reads as a provably-unnecessary condition.
 */

// `undefined`-returning rather than empty-bodied: an empty function body is a lint error.
const noop = (): void => undefined;

/** Constructed eagerly by the library's ResizeManager, and absent from jsdom. Left un-stubbed the
 * render throws, and the library's own error boundary swaps the whole diff for an error box. */
class NoopResizeObserver implements ResizeObserver {
  readonly observe = noop;
  readonly unobserve = noop;
  readonly disconnect = noop;
}

if (!Reflect.has(globalThis, 'ResizeObserver')) {
  Reflect.set(globalThis, 'ResizeObserver', NoopResizeObserver);
}

/** base-ui's ScrollAreaViewport calls `getAnimations()` from a timeout. That timer never outlived a
 * test before; the diff card's asynchronous highlight keeps the viewport alive long enough for it
 * to fire, and an uncaught throw there fails the run. */
if (typeof Element !== 'undefined' && !Reflect.has(Element.prototype, 'getAnimations')) {
  Reflect.set(Element.prototype, 'getAnimations', () => []);
}
