import type { SessionInfo } from '@linkcode/schema';

export interface ThreadRowProps {
  session: SessionInfo;
  /** Clock for the relative timestamp, ticked by the list so rows re-render together. */
  now: number;
  onPress: () => void;
}
