import { Card } from 'coss-ui/components/card';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import {
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from '../code-block';

export interface ArtifactFrameProps {
  /** Shown in the header (the fence language / kind id — technical, not translated). */
  kindLabel: string;
  /** Raw artifact source, for the copy button. */
  code: string;
  isIncomplete: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Chrome shared by inline artifact renderers: bordered card with a code-block-style
 * header (kind label, streaming indicator, copy-source button). */
export function ArtifactFrame({
  kindLabel,
  code,
  isIncomplete,
  className,
  children,
}: ArtifactFrameProps): React.ReactNode {
  const t = useTranslations('workbench.artifact');

  return (
    <Card className={cn('my-2 overflow-hidden', className)} data-artifact-kind={kindLabel}>
      <CodeBlockHeader>
        <CodeBlockTitle>{kindLabel}</CodeBlockTitle>
        <CodeBlockActions>
          {isIncomplete ? (
            <span className="animate-pulse text-muted-foreground">{t('streaming')}</span>
          ) : null}
          <CodeBlockCopyButton code={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      {children}
    </Card>
  );
}
