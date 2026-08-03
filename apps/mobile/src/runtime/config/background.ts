import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { registerBackgroundRefresh } from './lifecycle';
import { isMobileConfigRemoteEnabled, refreshMobileConfiguration } from './mobile';

const TASK_NAME = 'linkcode-configuration-refresh';

if (!TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, async () =>
    (await refreshMobileConfiguration())
      ? BackgroundTask.BackgroundTaskResult.Success
      : BackgroundTask.BackgroundTaskResult.Failed,
  );
}

export function registerMobileConfigBackgroundRefresh() {
  return registerBackgroundRefresh(isMobileConfigRemoteEnabled(), {
    isAvailable: async () =>
      (await TaskManager.isAvailableAsync()) &&
      (await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available,
    isRegistered: () => TaskManager.isTaskRegisteredAsync(TASK_NAME),
    register: () => BackgroundTask.registerTaskAsync(TASK_NAME),
  });
}
