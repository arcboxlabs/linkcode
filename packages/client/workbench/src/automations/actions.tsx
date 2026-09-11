import type { LoopRecord, Schedule, SessionId } from '@linkcode/schema';
import {
  deleteLoop,
  deleteSchedule,
  pauseSchedule,
  resumeSchedule,
  runScheduleOnce,
  stopLoop,
} from '@linkcode/sdk';
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from 'coss-ui/components/alert-dialog';
import { Button } from 'coss-ui/components/button';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from 'coss-ui/components/menu';
import { toastManager } from 'coss-ui/components/toast';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { EllipsisIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useMutation } from '../runtime/tayori';
import { useAutomationDraftState } from './draft-state';
import { useAutomationsViewStore } from './store';

export function AutomationActions({
  task,
  sessionId,
  onOpenSession,
}: {
  task: Schedule | LoopRecord;
  sessionId?: SessionId;
  onOpenSession?: (id: SessionId) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const pause = useMutation(pauseSchedule);
  const resume = useMutation(resumeSchedule);
  const run = useMutation(runScheduleOnce);
  const stop = useMutation(stopLoop);
  const removeSchedule = useMutation(deleteSchedule);
  const removeLoop = useMutation(deleteLoop);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [pending, setPending] = useState(false);
  const schedule = 'scheduleId' in task ? task : null;
  const loop = 'loopId' in task ? task : null;
  const waitingForStop = stopping && loop?.status === 'running';

  async function perform(action: () => Promise<unknown>, deleted = false): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await action();
      if (deleted) {
        setConfirmDelete(false);
        const state = useAutomationsViewStore.getState();
        if (
          state.selectedScheduleId === schedule?.scheduleId ||
          state.selectedLoopId === loop?.loopId
        ) {
          useAutomationDraftState.getState().setDirty(false);
          state.collapse();
        }
      }
    } catch (error_) {
      const message = extractErrorMessage(error_, false) ?? t('actionFailed');
      setError(message);
      setStopping(false);
      if (!deleted) {
        toastManager.add({ type: 'error', title: t('actionFailed'), description: message });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`${t('moreActions')}: ${task.spec.name ?? task.spec.prompt}`}
              disabled={pending || waitingForStop}
            />
          }
        >
          <EllipsisIcon className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          {sessionId && onOpenSession ? (
            <MenuItem onClick={() => onOpenSession(sessionId)}>{t('openThread')}</MenuItem>
          ) : null}
          {schedule && schedule.status !== 'completed' ? (
            <>
              <MenuItem
                onClick={() => {
                  void perform(() =>
                    schedule.status === 'active'
                      ? pause.trigger({ scheduleId: schedule.scheduleId })
                      : resume.trigger({ scheduleId: schedule.scheduleId }),
                  );
                }}
              >
                {t(schedule.status === 'active' ? 'schedule.pause' : 'schedule.resume')}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  void perform(() => run.trigger({ scheduleId: schedule.scheduleId }));
                }}
              >
                {t('schedule.runNow')}
              </MenuItem>
            </>
          ) : null}
          {loop?.status === 'running' ? (
            <MenuItem
              onClick={() => {
                setStopping(true);
                void perform(() => stop.trigger({ loopId: loop.loopId }));
              }}
            >
              {t('loop.stop')}
            </MenuItem>
          ) : (
            <MenuItem
              onClick={() => {
                setError(null);
                setConfirmDelete(true);
              }}
            >
              {t('delete')}
            </MenuItem>
          )}
        </MenuPopup>
      </Menu>
      {waitingForStop ? (
        <span role="status" className="text-muted-foreground text-xs">
          {t('loop.stopping')}
        </span>
      ) : null}
      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!pending) setConfirmDelete(open);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteConfirmDescription')}</AlertDialogDescription>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfirmDelete(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                void perform(
                  () =>
                    'scheduleId' in task
                      ? removeSchedule.trigger({ scheduleId: task.scheduleId })
                      : removeLoop.trigger({ loopId: task.loopId }),
                  true,
                );
              }}
            >
              {t('delete')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
