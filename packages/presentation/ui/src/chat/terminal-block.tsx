import { useTranslations } from 'use-intl';
import { ChatCardActions, ChatCardHeader } from './chat-card';
import { CopyIconButton } from './copy-icon-button';
import { Terminal, TerminalContent, TerminalTitle } from './terminal';

/** Read-only view of an agent-spawned terminal referenced from tool-call content, streamed live. */
export function TerminalBlock({
  terminalId,
  output,
  command,
}: {
  terminalId: string;
  output?: string;
  /** The command the tool ran in this terminal; shown nowhere, but offered for copying. */
  command?: string;
}): React.ReactNode {
  const t = useTranslations('workbench.tool');

  return (
    <Terminal>
      <ChatCardHeader>
        <TerminalTitle>
          {t('terminal')} <span className="opacity-70">{terminalId}</span>
        </TerminalTitle>
        {command ? (
          <ChatCardActions>
            <CopyIconButton label="command" value={command} />
          </ChatCardActions>
        ) : null}
      </ChatCardHeader>
      {output?.trim() ? <TerminalContent>{output}</TerminalContent> : null}
    </Terminal>
  );
}
