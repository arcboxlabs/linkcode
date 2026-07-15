import type { SessionStatus } from '@linkcode/schema';
import { View } from 'react-native';

/**
 * Adapted from desktop's `SESSION_STATUS_DOT_CLASS` — HeroUI Native has no `info` /
 * `muted-foreground` tokens, so `starting` maps to `accent` and the idle/stopped grays
 * ride opacity modifiers on `muted`.
 */
const STATUS_DOT_CLASS: Record<SessionStatus, string> = {
  starting: 'bg-accent',
  idle: 'bg-muted/40',
  running: 'bg-success',
  'awaiting-input': 'bg-warning',
  stopped: 'bg-muted/25',
};

export interface StatusDotProps {
  status: SessionStatus;
  /** Translated status name, used as the accessibility label. */
  label: string;
}

/** Glanceable session status: an 8px dot, color-coded identically everywhere. */
export function StatusDot({ status, label }: StatusDotProps): React.ReactNode {
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label}
      className={`size-2 rounded-full ${STATUS_DOT_CLASS[status]}`}
    />
  );
}
