import { useTerminalOutput } from '@linkcode/client-core';
import { useTranslations } from 'use-intl';
import { Terminal, TerminalContent, TerminalHeader, TerminalTitle } from './terminal';

/** Read-only view of an agent-spawned terminal referenced from tool-call content, streamed live. */
export function TerminalBlock({ terminalId }: { terminalId: string }): React.ReactNode {
  const t = useTranslations('workbench.tool');
  const output = useTerminalOutput(terminalId);

  return (
    <Terminal>
      <TerminalHeader>
        <TerminalTitle>
          {t('terminal')} <span className="opacity-70">{terminalId}</span>
        </TerminalTitle>
      </TerminalHeader>
      {output ? <TerminalContent>{output}</TerminalContent> : null}
    </Terminal>
  );
}
