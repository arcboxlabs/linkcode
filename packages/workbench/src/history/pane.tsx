import type { AgentHistoryId, AgentKind } from '@linkcode/schema';
import { resumeSession } from '@linkcode/sdk';
import type { HistoryBrowserEntry } from '@linkcode/ui';
import { AGENT_LABELS, HistoryBrowserPane } from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useState } from 'react';
import { useMutation } from '../runtime/tayori';
import { useWorkbenchSessions } from '../surface/use-workbench-sessions';
import { importedSessionByHistoryId, importedSessionKey } from './imported';
import { useProviderHistory } from './use-provider-history';

/**
 * Binds one provider's global history to the browser pane: dedup against the session list,
 * import-in-place, and open (import if needed → resume → select, which also lowers the overlay).
 *
 * A second `useWorkbenchSessions` instance is safe here: the session list rides one shared SWR
 * key and selection/navigation live in module-scope stores.
 */
export function RuntimeProviderHistoryPane({ kind }: { kind: AgentKind }): React.ReactNode {
  const history = useProviderHistory(kind);
  const [openError, setOpenError] = useState<unknown>(null);
  const sessions = useWorkbenchSessions(setOpenError);
  const resumeMutation = useMutation(resumeSession, { onError: setOpenError });

  const imported = importedSessionByHistoryId(sessions.sessions);
  const entries: HistoryBrowserEntry[] = history.entries.map((entry) => ({
    historyId: entry.historyId,
    title: entry.title ?? AGENT_LABELS[entry.kind],
    cwd: entry.cwd,
    timestamp: entry.updatedAt ?? entry.createdAt,
    messageCount: entry.messageCount,
    imported: imported.has(importedSessionKey(entry.kind, entry.historyId)),
  }));

  function entryById(historyId: AgentHistoryId) {
    return history.entries.find((entry) => entry.historyId === historyId);
  }

  function handleImport(historyId: AgentHistoryId): void {
    const entry = entryById(historyId);
    if (!entry) return;
    // The dedup badge flips once the revalidated session list carries the imported origin.
    void history
      .importEntry(entry)
      .then(() => sessions.refresh())
      .catch(noop);
  }

  function handleOpen(historyId: AgentHistoryId): void {
    const entry = entryById(historyId);
    if (!entry) return;
    const existing = imported.get(importedSessionKey(entry.kind, entry.historyId));
    if (existing !== undefined) {
      sessions.select(existing);
      return;
    }
    setOpenError(null);
    void history
      .importEntry(entry)
      .then(async (sessionId) => {
        // The fresh id isn't in this render's session list yet, so select()'s own cold-resume
        // check can't see it — wake it explicitly before entering.
        await resumeMutation.trigger({ sessionId }).catch(noop);
        void sessions.refresh();
        sessions.select(sessionId);
      })
      .catch(noop);
  }

  const inlineError = history.importError ?? openError;
  return (
    <HistoryBrowserPane
      providerLabel={AGENT_LABELS[kind]}
      entries={entries}
      isLoading={history.isLoading}
      loadError={
        history.loadError == null ? null : (extractErrorMessage(history.loadError, false) ?? '')
      }
      importingId={history.importingId}
      importError={inlineError == null ? null : (extractErrorMessage(inlineError, false) ?? '')}
      onImport={handleImport}
      onOpen={handleOpen}
      onRefresh={history.refresh}
    />
  );
}
