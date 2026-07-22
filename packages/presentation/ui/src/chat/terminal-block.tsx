import { useTranslations } from 'use-intl';
import { ChatCardHeader } from './chat-card';
import { Terminal, TerminalContent, TerminalTitle } from './terminal';

/** Read-only view of an agent-spawned terminal referenced from tool-call content, streamed live. */
export function TerminalBlock({
  terminalId,
  output,
}: {
  terminalId: string;
  output?: string;
}): React.ReactNode {
  const t = useTranslations('workbench.tool');

  return (
    <Terminal>
      <ChatCardHeader>
        <TerminalTitle>
          {t('terminal')} <span className="opacity-70">{terminalId}</span>
        </TerminalTitle>
      </ChatCardHeader>
      {output?.trim() ? <TerminalContent>{output}</TerminalContent> : null}
    </Terminal>
  );
}
