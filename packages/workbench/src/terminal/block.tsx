import { useTerminalOutput } from '@linkcode/client-core';
import { TerminalBlock } from '@linkcode/ui';

/** Adapter subscribing a rendered `TerminalBlock` to the daemon-backed terminal output stream. */
export function RuntimeTerminalBlock({ terminalId }: { terminalId: string }): React.ReactNode {
  const output = useTerminalOutput(terminalId);
  return <TerminalBlock terminalId={terminalId} output={output} />;
}
