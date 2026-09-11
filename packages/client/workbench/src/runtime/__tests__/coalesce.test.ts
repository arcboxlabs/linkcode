import { wait } from 'foxts/wait';
import { expect, it, vi } from 'vitest';
import { coalesceRuns } from '../coalesce';
import { deferred } from './connection-controller-test-helpers';

it('collapses a burst arriving mid-run into a single trailing run', async () => {
  const gates = [deferred(), deferred()];
  let started = 0;
  const trigger = coalesceRuns(() => {
    const gate = gates[started] ?? deferred();
    started += 1;
    return gate.promise;
  }, new AbortController().signal);

  trigger();
  expect(started).toBe(1);

  // Three more frames while the first run is still in flight: they must collapse into one.
  trigger();
  trigger();
  trigger();
  expect(started).toBe(1);

  gates[0].resolve();
  await vi.waitFor(() => expect(started).toBe(2));

  gates[1].resolve();
  await wait(0);
  expect(started).toBe(2);
});

it('runs again for a trigger that arrives after the previous run settled', async () => {
  let started = 0;
  const trigger = coalesceRuns(() => {
    started += 1;
    return Promise.resolve();
  }, new AbortController().signal);

  trigger();
  await wait(0);
  trigger();
  await wait(0);

  expect(started).toBe(2);
});

it('keeps draining after a failed run', async () => {
  let started = 0;
  const trigger = coalesceRuns(() => {
    started += 1;
    return started === 1 ? Promise.reject(new Error('fetch failed')) : Promise.resolve();
  }, new AbortController().signal);

  trigger();
  trigger();
  await vi.waitFor(() => expect(started).toBe(2));
});

it.each(['resolve', 'reject'] as const)(
  'drops queued work after abort when the in-flight run settles via %s',
  async (outcome) => {
    const controller = new AbortController();
    const gate = deferred();
    const run = vi.fn(() => gate.promise);
    const trigger = coalesceRuns(run, controller.signal);

    trigger();
    trigger();
    expect(run).toHaveBeenCalledTimes(1);
    controller.abort();
    if (outcome === 'resolve') gate.resolve();
    else gate.reject(new Error('client disposed'));
    await wait(0);
    expect(run).toHaveBeenCalledTimes(1);

    trigger();
    expect(run).toHaveBeenCalledTimes(1);
  },
);
