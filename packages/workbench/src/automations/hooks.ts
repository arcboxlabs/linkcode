import { useLinkCodeClient } from '@linkcode/client-core';
import type { LoopId, LoopLogEntry, ScheduleId } from '@linkcode/schema';
import { inspectLoop, listLoops, listScheduleRuns, listSchedules } from '@linkcode/sdk';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { noop } from 'foxts/noop';
import { useSyncExternalStore } from 'react';
import { useData } from '../runtime/tayori';

/**
 * Every schedule the daemon holds. The list is a cheap RPC, so `schedule.*` broadcasts simply
 * revalidate it instead of merging patches client-side (the `useWorkspaceScripts` pattern).
 */
export function useSchedules() {
  const client = useLinkCodeClient();
  const result = useData(listSchedules, {}, { keepPreviousData: true });
  const { mutate } = result;
  useAbortableEffect(
    (signal) =>
      client.subscribeScheduleEvents(() => {
        if (!signal.aborted) void mutate();
      }),
    [client, mutate],
  );
  return result;
}

/** A schedule's run history, newest first. Pass null to pause (no schedule selected). */
export function useScheduleRuns(scheduleId: ScheduleId | null) {
  const client = useLinkCodeClient();
  const result = useData(listScheduleRuns, scheduleId === null ? null : { scheduleId });
  const { mutate } = result;
  useAbortableEffect(
    (signal) =>
      client.subscribeScheduleEvents((event) => {
        if ((event.type === 'run' || event.type === 'changed') && !signal.aborted) void mutate();
      }),
    [client, mutate],
  );
  return result;
}

/**
 * Every loop the daemon holds. Like {@link useSchedules}, `loop.*` broadcasts revalidate the cheap
 * list RPC rather than merging patches client-side.
 */
export function useLoops() {
  const client = useLinkCodeClient();
  const result = useData(listLoops, {}, { keepPreviousData: true });
  const { mutate } = result;
  useAbortableEffect(
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
  useAbortableEffect(
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
