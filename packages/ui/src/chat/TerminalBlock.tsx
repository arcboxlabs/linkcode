import { TerminalIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslations } from 'use-intl';

export function TerminalBlock({ terminalId }: { terminalId: string }): ReactElement {
  const t = useTranslations('workbench.tool');

  return (
    <div className="my-1 flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 font-mono text-[12.5px] text-muted-foreground">
      <TerminalIcon className="size-3.5" />
      <span>{t('terminal')}</span>
      <span className="opacity-70">{terminalId}</span>
    </div>
  );
}
