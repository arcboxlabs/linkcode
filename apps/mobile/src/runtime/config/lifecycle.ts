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

const EMERGENCY_INITIAL_DELAY_MS = 1000;
const EMERGENCY_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const EMERGENCY_RETRY_DELAY_MS = 60 * 1000;

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

export function subscribeToEmergencyRefresh(
  source: ForegroundStateSource,
  refresh: () => Promise<boolean>,
): () => void {
  let active = source.currentState === 'active';
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancelTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (delay: number) => {
    cancelTimer();
    if (!active) return;
    const startedInGeneration = generation;
    timer = setTimeout(() => {
      timer = undefined;
      void refresh()
        .then((success) => {
          if (active && generation === startedInGeneration) {
            schedule(success ? EMERGENCY_REFRESH_INTERVAL_MS : EMERGENCY_RETRY_DELAY_MS);
          }
        })
        .catch(() => {
          if (active && generation === startedInGeneration) schedule(EMERGENCY_RETRY_DELAY_MS);
        });
    }, delay);
  };

  if (active) schedule(EMERGENCY_INITIAL_DELAY_MS);
  const subscription = source.addEventListener('change', (next) => {
    const nextActive = next === 'active';
    if (nextActive === active) return;
    active = nextActive;
    generation += 1;
    if (active) schedule(EMERGENCY_INITIAL_DELAY_MS);
    else cancelTimer();
  });
  return () => {
    active = false;
    generation += 1;
    cancelTimer();
    subscription.remove();
  };
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
