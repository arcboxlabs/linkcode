import type { SessionStatus } from '@linkcode/schema';
import { View } from 'react-native';

const DOT_CLASS = {
  starting: 'bg-warning',
  idle: 'bg-default',
  running: 'bg-success',
  'awaiting-input': 'bg-warning',
  stopped: 'bg-muted',
} as const satisfies Record<SessionStatus, string>;

/** Compact status indicator for thread rows; the conversation header keeps the labeled chip. */
export function SessionStatusDot({ status }: { status: SessionStatus }): React.ReactNode {
  return <View className={`h-2 w-2 rounded-full ${DOT_CLASS[status]}`} />;
}
