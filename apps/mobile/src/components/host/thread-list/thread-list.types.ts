import type { SessionInfo } from '@linkcode/schema';
import type { ThreadGroup } from '@linkcode/ui/native';

export interface ThreadListProps {
  groups: ThreadGroup[];
  labelFor: (group: ThreadGroup) => string;
  onOpenThread: (sessionId: SessionInfo['sessionId']) => void;
  /** Pull-to-refresh driver; the platform view holds its spinner until this resolves. */
  onRefresh: () => Promise<void>;
}
