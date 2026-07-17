import { useLinkCodeClient } from '@linkcode/client-core';
import type { ScheduleId } from '@linkcode/schema';
import { listScheduleRuns, listSchedules } from '@linkcode/sdk';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
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
