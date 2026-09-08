import { expect, it } from 'vitest';
import { coalesceRuns } from '../coalesce';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolveDeferred!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveDeferred = resolve;
  });
  return { promise, resolve: resolveDeferred };
}

it('collapses a burst arriving mid-run into a single trailing run', async () => {
  const gates = [deferred(), deferred()];
  let started = 0;
  const trigger = coalesceRuns(() => {
    const gate = gates[started] ?? deferred();
    started += 1;
    return gate.promise;
  });

  trigger();
  expect(started).toBe(1);

  // Three more frames while the first run is still in flight: they must collapse into one.
  trigger();
  trigger();
  trigger();
  expect(started).toBe(1);

  gates[0].resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(started).toBe(2);

  gates[1].resolve();
  await gates[1].promise;
  await Promise.resolve();
  expect(started).toBe(2);
});

it('runs again for a trigger that arrives after the previous run settled', async () => {
  let started = 0;
  const trigger = coalesceRuns(() => {
    started += 1;
    return Promise.resolve();
  });

  trigger();
  await Promise.resolve();
  await Promise.resolve();
  trigger();
  await Promise.resolve();
  await Promise.resolve();

  expect(started).toBe(2);
});

it('keeps draining after a failed run', async () => {
  let started = 0;
  const trigger = coalesceRuns(() => {
    started += 1;
    return started === 1 ? Promise.reject(new Error('fetch failed')) : Promise.resolve();
  });

  trigger();
  trigger();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(started).toBe(2);
});
