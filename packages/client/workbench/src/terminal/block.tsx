import { useLinkCodeClient, useTerminalOutput } from '@linkcode/client-core';
import { TerminalBlock } from '@linkcode/ui';
import { useEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

/** Adapter subscribing a rendered `TerminalBlock` to the daemon-backed terminal output stream. */
export function RuntimeTerminalBlock({ terminalId }: { terminalId: string }): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const client = useLinkCodeClient();
  const output = useTerminalOutput(terminalId);
  const [failedTerminalId, setFailedTerminalId] = useState<string | null>(null);

  useEffect(
    (signal) => {
      let attached = false;
      void client
        .attachTerminal(terminalId)
        .then(() => {
          attached = true;
          if (signal.aborted) {
            attached = false;
            client.detachTerminal(terminalId);
          } else {
            setFailedTerminalId((failed) => (failed === terminalId ? null : failed));
          }
        })
        .catch(() => {
          if (!signal.aborted) setFailedTerminalId(terminalId);
        });
      return () => {
        if (!attached) return;
        attached = false;
        client.detachTerminal(terminalId);
      };
    },
    [client, terminalId],
  );

  if (failedTerminalId === terminalId) {
    return (
      <div className="flex items-center justify-center py-3 text-muted-foreground text-sm">
        {t('terminalFailed')}
      </div>
    );
  }
  return <TerminalBlock terminalId={terminalId} output={output} />;
}
