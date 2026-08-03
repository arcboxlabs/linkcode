export interface ForegroundStateSource {
  readonly currentState: string;
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}

export interface BackgroundRefreshScheduler {
  isAvailable(): Promise<boolean>;
  isRegistered(): Promise<boolean>;
  register(): Promise<void>;
}

export type BackgroundRefreshRegistration = 'disabled' | 'registered' | 'unsupported';

export function subscribeToForegroundRefresh(
  source: ForegroundStateSource,
  refresh: () => void,
): () => void {
  let previous = source.currentState;
  const subscription = source.addEventListener('change', (next) => {
    if (next === 'active' && previous !== 'active') refresh();
    previous = next;
  });
  return () => subscription.remove();
}

export async function registerBackgroundRefresh(
  enabled: boolean,
  scheduler: BackgroundRefreshScheduler,
): Promise<BackgroundRefreshRegistration> {
  if (!enabled) return 'disabled';
  if (!(await scheduler.isAvailable())) return 'unsupported';
  if (!(await scheduler.isRegistered())) await scheduler.register();
  return 'registered';
}
