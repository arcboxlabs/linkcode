import { Button } from 'coss-ui/components/button';
import { Card } from 'coss-ui/components/card';
import { FileIcon, FileTextIcon, FileTypeIcon, ImageIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { useArtifactHostActions } from './context';
import { artifactKindForPath, fileBasename } from './file-kind';

const ICON_BY_KIND: Record<string, React.ReactNode> = {
  markdown: <FileTextIcon />,
  text: <FileTextIcon />,
  pdf: <FileTypeIcon />,
  image: <ImageIcon />,
};

/**
 * Produced-file card shown in chat (under completed move tools, Codex end-resource
 * style). Clicking opens the file in the host viewer when the shell provides one.
 */
export function FileArtifactCard({
  path,
  className,
}: {
  /** Workspace-relative or absolute path as the agent reported it. */
  path: string;
  className?: string;
}): React.ReactNode {
  const t = useTranslations('workbench.artifact');
  const actions = useArtifactHostActions();
  const kind = artifactKindForPath(path);
  const openFile = actions?.openFile;

  const body = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground [&_svg]:size-4">
        {(kind !== null && ICON_BY_KIND[kind]) || <FileIcon />}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-medium text-[13px] text-foreground">
          {fileBasename(path)}
        </span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">{path}</span>
      </span>
    </>
  );

  const frame = 'my-1 w-full max-w-md overflow-hidden';

  if (!openFile) {
    return (
      <Card className={cn(frame, 'flex-row items-center gap-2.5 px-2.5 py-2', className)}>
        {body}
      </Card>
    );
  }

  return (
    <Card className={cn(frame, className)}>
      <Button
        className="h-auto w-full justify-start rounded-2xl border-0 px-2.5 py-2 font-normal focus-visible:ring-inset"
        title={t('openFile')}
        variant="ghost"
        onClick={() => openFile(path)}
      >
        {body}
      </Button>
    </Card>
  );
}
