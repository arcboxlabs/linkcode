import type { SessionInfo } from '@linkcode/schema';
import { AGENT_LABELS, repositoryLabel } from '@linkcode/ui/native';

/** The title a thread is listed and searched under — the same fallback the row renders. */
export function threadTitle(session: SessionInfo): string {
  return session.title ?? `${AGENT_LABELS[session.kind]} in ${repositoryLabel(session.cwd)}`;
}
