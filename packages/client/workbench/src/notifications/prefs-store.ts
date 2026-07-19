import { zodPersist } from '@linkcode/common/zustand';
import { z } from 'zod';
import { create } from 'zustand';

const PersistedNotificationPrefsSchema = z
  .object({
    enabled: z.boolean(),
    turnCompleted: z.boolean(),
    awaitingApproval: z.boolean(),
    error: z.boolean(),
  })
  .partial();
type PersistedNotificationPrefs = z.infer<typeof PersistedNotificationPrefsSchema>;

export type NotificationPrefKey = 'enabled' | 'turnCompleted' | 'awaitingApproval' | 'error';

export interface NotificationPrefsState {
  /** Master switch; the per-reason toggles only apply while this is on. */
  enabled: boolean;
  turnCompleted: boolean;
  awaitingApproval: boolean;
  error: boolean;
  setPref: (key: NotificationPrefKey, value: boolean) => void;
}

/** OS-notification preferences, shared by desktop and webview (presenters differ, policy doesn't). */
export const useNotificationPrefsStore = create<NotificationPrefsState>()(
  zodPersist<
    NotificationPrefsState,
    [],
    [],
    PersistedNotificationPrefs,
    PersistedNotificationPrefs
  >(
    (set) => ({
      enabled: true,
      turnCompleted: true,
      awaitingApproval: true,
      error: true,
      setPref: (key, value) => set({ [key]: value }),
    }),
    {
      name: 'linkcode.workbench.notifications:v1',
      schema: PersistedNotificationPrefsSchema,
      partialize: ({ enabled, turnCompleted, awaitingApproval, error }) => ({
        enabled,
        turnCompleted,
        awaitingApproval,
        error,
      }),
    },
  ),
);
