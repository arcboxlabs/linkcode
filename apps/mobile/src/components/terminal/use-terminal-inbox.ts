import { useLinkCodeClient } from '@linkcode/client-core';
import type { TerminalMetadata } from '@linkcode/schema';
import { useFocusEffect, useRouter } from 'expo-router';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useCallback, useState } from 'react';

const INITIAL_TERMINAL_SIZE = { cols: 80, rows: 24 };

export interface TerminalInboxState {
  terminals: TerminalMetadata[];
  loading: boolean;
  loadError: string | null;
  createError: string | null;
  creating: boolean;
  /** Pull-to-refresh driver; the platform view holds its spinner until this resolves. */
  onRefresh: () => Promise<void>;
  /** Full-screen retry after a load error: re-enters the loading state around a refresh. */
  retry: () => void;
  openTerminal: (terminalId: string, takeControl?: boolean) => void;
  onCreate: (cwd: string) => Promise<boolean>;
}

/** The terminal inbox view model: attach to a running PTY or start a new one on the host.
 * `onCreated` closes whatever surface collected the cwd (the new-terminal sheet). */
export function useTerminalInbox(onCreated: () => void): TerminalInboxState {
  const router = useRouter();
  const client = useLinkCodeClient();
  const [terminals, setTerminals] = useState<TerminalMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async () => (await client.listTerminals()).sort((a, b) => b.createdAt - a.createdAt),
    [client],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoadError(null);
      void load()
        .then((nextTerminals) => {
          if (active) setTerminals(nextTerminals);
        })
        .catch((error_: unknown) => {
          if (active) setLoadError(extractErrorMessage(error_, false) ?? 'Unknown error');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [load]),
  );

  const onRefresh = async () => {
    setLoadError(null);
    try {
      setTerminals(await load());
    } catch (error_) {
      setLoadError(extractErrorMessage(error_, false) ?? 'Unknown error');
    }
  };

  const retry = () => {
    setLoading(true);
    void onRefresh().finally(() => setLoading(false));
  };

  const openTerminal = (terminalId: string, takeControl = false) => {
    const query = takeControl ? '?takeover=1' : '';
    router.push(`/terminal/${encodeURIComponent(terminalId)}${query}`);
  };

  const onCreate = async (cwd: string): Promise<boolean> => {
    if (creating) return false;
    setCreating(true);
    setCreateError(null);
    try {
      const terminalId = await client.openTerminal({
        ...INITIAL_TERMINAL_SIZE,
        cwd: cwd || undefined,
      });
      client.detachTerminal(terminalId);
      onCreated();
      openTerminal(terminalId, true);
      return true;
    } catch (error_) {
      setCreateError(extractErrorMessage(error_, false) ?? 'Unknown error');
      return false;
    } finally {
      setCreating(false);
    }
  };

  return {
    terminals,
    loading,
    loadError,
    createError,
    creating,
    onRefresh,
    retry,
    openTerminal,
    onCreate,
  };
}
