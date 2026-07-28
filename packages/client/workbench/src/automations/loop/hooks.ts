import { useLinkCodeClient } from '@linkcode/client-core';
import type { LoopId, LoopLogEntry } from '@linkcode/schema';
import { inspectLoop, listLoops } from '@linkcode/sdk';
import { useEffect } from 'foxact/use-abortable-effect';
import { noop } from 'foxts/noop';
import { useSyncExternalStore } from 'react';
import { useData } from '../../runtime/tayori';

/**
 * Every loop the daemon holds. `loop.*` broadcasts revalidate the cheap list RPC rather than
 * merging patches client-side.
 */
export function useLoops() {
  const client = useLinkCodeClient();
  const result = useData(listLoops, {}, { keepPreviousData: true });
  const { mutate } = result;
  useEffect(
    (signal) =>
      client.subscribeLoopEvents(() => {
        if (!signal.aborted) void mutate();
      }),
    [client, mutate],
  );
  return result;
}

/**
 * One loop's record + iterations. Revalidates on any `loop.*` broadcast (iteration/change); also
 * seeds the client log buffer for {@link useLoopLog}. Pass null to pause (no loop selected).
 */
export function useLoopInspection(loopId: LoopId | null) {
  const client = useLinkCodeClient();
  const result = useData(inspectLoop, loopId === null ? null : { loopId });
  const { mutate } = result;
  useEffect(
    (signal) =>
      client.subscribeLoopEvents((event) => {
        const matches =
          (event.type === 'changed' && event.loop.loopId === loopId) ||
          (event.type === 'iteration' && event.iteration.loopId === loopId);
        if (matches && !signal.aborted) void mutate();
      }),
    [client, mutate, loopId],
  );
  return result;
}

const EMPTY_LOG: readonly LoopLogEntry[] = [];

/** A loop's live log tail, backed by the client-side ring buffer (useSyncExternalStore). */
export function useLoopLog(loopId: LoopId | null): readonly LoopLogEntry[] {
  const client = useLinkCodeClient();
  return useSyncExternalStore(
    (onChange) => (loopId === null ? noop : client.subscribeLoopLog(loopId, onChange)),
    () => (loopId === null ? EMPTY_LOG : client.loopLogSnapshot(loopId)),
  );
}
