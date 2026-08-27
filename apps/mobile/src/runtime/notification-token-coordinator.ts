export interface NotificationTokenIntent {
  readonly userId: string | null;
}

export function createNotificationTokenCoordinator() {
  let intent: NotificationTokenIntent = { userId: null };
  let tail: Promise<unknown> = Promise.resolve();

  const selectUser = (userId: string | null): NotificationTokenIntent => {
    if (intent.userId === userId) return intent;
    intent = { userId };
    return intent;
  };

  const enqueue = <T>(operation: () => T | PromiseLike<T>): Promise<T> => {
    const result = tail.catch(() => null).then(operation);
    // Keep the queue live after the caller observes the original rejection.
    tail = result.catch(() => null);
    return result;
  };

  return {
    selectUser,
    getSelectedUser: () => intent.userId,
    isCurrent: (candidate: NotificationTokenIntent) => candidate === intent,
    sync: (
      userId: string,
      acquireToken: () => string | PromiseLike<string>,
      registerToken: (token: string) => void | PromiseLike<void>,
    ): Promise<void> =>
      enqueue(async () => {
        if (intent.userId !== userId) return;
        const token = await acquireToken();
        if (intent.userId !== userId) return;
        await registerToken(token);
      }),
    revoke: (revokeToken: () => void | PromiseLike<void>): Promise<void> => enqueue(revokeToken),
  };
}
