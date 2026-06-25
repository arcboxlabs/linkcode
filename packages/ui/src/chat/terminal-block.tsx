import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { Terminal, TerminalHeader, TerminalTitle } from './terminal';

export function TerminalBlock({ terminalId }: { terminalId: string }): ReactNode {
  const t = useTranslations('workbench.tool');

  return (
    <Terminal>
      <TerminalHeader>
        <TerminalTitle>
          {t('terminal')} <span className="opacity-70">{terminalId}</span>
        </TerminalTitle>
      </TerminalHeader>
    </Terminal>
  );
}
