import { Frame } from 'coss-ui/components/frame';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { ChatCardActions, ChatCardHeader, ChatCardPanel, ChatCardTitle } from '../chat-card';
import { CodeBlockCopyButton } from '../code-block';

export interface ArtifactFrameProps {
  /** Shown in the header (the fence language / kind id — technical, not translated). */
  kindLabel: string;
  /** Raw artifact source, for the copy button. */
  code: string;
  isIncomplete: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Chrome shared by inline artifact renderers: coss-ui frame with the kind label,
 * streaming indicator, and copy-source button in the frame header. */
export function ArtifactFrame({
  kindLabel,
  code,
  isIncomplete,
  className,
  children,
}: ArtifactFrameProps): React.ReactNode {
  const t = useTranslations('workbench.artifact');

  return (
    <Frame className={cn('my-2', className)} data-artifact-kind={kindLabel}>
      <ChatCardHeader>
        <ChatCardTitle>{kindLabel}</ChatCardTitle>
        <ChatCardActions>
          {isIncomplete ? <span className="animate-pulse">{t('streaming')}</span> : null}
          <CodeBlockCopyButton code={code} />
        </ChatCardActions>
      </ChatCardHeader>
      <ChatCardPanel className="overflow-hidden p-0">{children}</ChatCardPanel>
    </Frame>
  );
}
