import type { SessionStatus } from '@linkcode/schema';

export const SESSION_STATUS_DOT_CLASS: Record<SessionStatus, string> = {
  starting: 'bg-info',
  idle: 'bg-muted-foreground/40',
  running: 'bg-success',
  'awaiting-input': 'bg-warning',
  stopped: 'bg-muted-foreground/25',
};
