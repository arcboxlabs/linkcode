import { Avatar, AvatarFallback } from 'coss-ui/components/avatar';
import { Badge } from 'coss-ui/components/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { FileIcon, GitCommitIcon, MinusIcon, PlusIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import type { CopyIconButtonProps } from './copy-icon-button';
import { CopyIconButton } from './copy-icon-button';
import { CHAT_DISCLOSURE_TRIGGER_CLASS_NAME, ChatDisclosureChevron } from './disclosure-header';

// TODO(linkcode-schema): Provisional UI-only commit metadata, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when git/checkpoint events expose structured commits.
export interface ChatCommit {
  id: string;
  hash: string;
  message: string;
  authorName?: string;
  authorInitials?: string;
  createdAt?: string;
  files?: ChatCommitFile[];
}

export interface ChatCommitFile {
  id: string;
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions?: number;
  deletions?: number;
}

export type CommitProps = React.ComponentProps<typeof Collapsible> & {
  commit: ChatCommit;
};

export function Commit({
  className,
  commit,
  defaultOpen = false,
  children,
  ...props
}: CommitProps): React.ReactNode {
  return (
    <Collapsible
      className={cn(
        'my-2 overflow-hidden rounded-lg border border-border bg-card text-sm',
        className,
      )}
      defaultOpen={defaultOpen}
      {...props}
    >
      {children ?? (
        <>
          <CommitHeader commit={commit} />
          <CommitContent>
            <CommitFiles files={commit.files ?? []} />
          </CommitContent>
        </>
      )}
    </Collapsible>
  );
}

export type CommitHeaderProps = React.ComponentProps<'div'> & {
  commit: ChatCommit;
};

export function CommitHeader({
  className,
  commit,
  children,
  ...props
}: CommitHeaderProps): React.ReactNode {
  return (
    <div
      className={cn(
        'group flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <CollapsibleTrigger
            className={cn(CHAT_DISCLOSURE_TRIGGER_CLASS_NAME, 'flex-1 gap-3 py-0')}
          >
            <CommitAvatar commit={commit} />
            <div className="min-w-0 shrink overflow-hidden">
              <div className="truncate font-medium opacity-80">{commit.message}</div>
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <CommitHash hash={commit.hash} />
                {commit.authorName ? (
                  <span className="min-w-0 shrink truncate">{commit.authorName}</span>
                ) : null}
                {commit.createdAt ? (
                  <time className="shrink-0" dateTime={commit.createdAt}>
                    {commit.createdAt}
                  </time>
                ) : null}
              </div>
            </div>
            <ChatDisclosureChevron />
          </CollapsibleTrigger>
          <CommitCopyButton hash={commit.hash} />
        </>
      )}
    </div>
  );
}

export type CommitAvatarProps = React.ComponentProps<typeof Avatar> & {
  commit: ChatCommit;
};

export function CommitAvatar({ className, commit, ...props }: CommitAvatarProps): React.ReactNode {
  return (
    <Avatar className={cn('shrink-0', className)} {...props}>
      <AvatarFallback>
        {commit.authorInitials ?? <GitCommitIcon className="size-3.5 text-muted-foreground" />}
      </AvatarFallback>
    </Avatar>
  );
}

export type CommitHashProps = React.ComponentProps<'span'> & {
  hash: string;
};

export function CommitHash({ className, hash, ...props }: CommitHashProps): React.ReactNode {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 font-mono', className)} {...props}>
      <GitCommitIcon className="size-3" />
      {hash.slice(0, 8)}
    </span>
  );
}

export type CommitCopyButtonProps = Omit<
  CopyIconButtonProps,
  'value' | 'label' | 'stopPropagation' | 'iconClassName'
> & {
  hash: string;
};

export function CommitCopyButton({
  className,
  hash,
  ...props
}: CommitCopyButtonProps): React.ReactNode {
  return (
    <CopyIconButton
      className={cn('shrink-0', className)}
      iconClassName="size-3.5"
      label="commit hash"
      stopPropagation
      value={hash}
      {...props}
    />
  );
}

export type CommitContentProps = React.ComponentProps<typeof CollapsibleContent>;

export function CommitContent({ className, ...props }: CommitContentProps): React.ReactNode {
  return <CollapsibleContent className={cn('border-t border-border p-2', className)} {...props} />;
}

export type CommitFilesProps = React.ComponentProps<'div'> & {
  files: readonly ChatCommitFile[];
};

export function CommitFiles({
  className,
  files,
  children,
  ...props
}: CommitFilesProps): React.ReactNode {
  return (
    <div className={cn('space-y-1', className)} {...props}>
      {children ?? files.map((file) => <CommitFile key={file.id} file={file} />)}
    </div>
  );
}

export type CommitFileProps = React.ComponentProps<'div'> & {
  file: ChatCommitFile;
};

export function CommitFile({
  className,
  file,
  children,
  ...props
}: CommitFileProps): React.ReactNode {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-muted',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <CommitFileStatus status={file.status} />
          <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
          <CommitFileChanges additions={file.additions} deletions={file.deletions} />
        </>
      )}
    </div>
  );
}

export type CommitFileStatusProps = React.ComponentProps<typeof Badge> & {
  status: ChatCommitFile['status'];
};

export function CommitFileStatus({
  className,
  status,
  children,
  ...props
}: CommitFileStatusProps): React.ReactNode {
  return (
    <Badge
      className={cn('font-mono', className)}
      size="sm"
      variant={commitStatusVariant(status)}
      {...props}
    >
      {children ?? commitStatusLabel(status)}
    </Badge>
  );
}

export type CommitFileChangesProps = React.ComponentProps<'div'> & {
  additions?: number;
  deletions?: number;
};

export function CommitFileChanges({
  className,
  additions = 0,
  deletions = 0,
  ...props
}: CommitFileChangesProps): React.ReactNode {
  if (additions === 0 && deletions === 0) return null;

  return (
    <div className={cn('flex shrink-0 items-center gap-1 font-mono text-xs', className)} {...props}>
      {additions > 0 ? (
        <span className="inline-flex items-center text-success-foreground">
          <PlusIcon className="size-3" />
          {additions}
        </span>
      ) : null}
      {deletions > 0 ? (
        <span className="inline-flex items-center text-destructive-foreground">
          <MinusIcon className="size-3" />
          {deletions}
        </span>
      ) : null}
    </div>
  );
}

function commitStatusLabel(status: ChatCommitFile['status']): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    default:
      return 'M';
  }
}

function commitStatusVariant(
  status: ChatCommitFile['status'],
): React.ComponentProps<typeof Badge>['variant'] {
  switch (status) {
    case 'added':
      return 'success';
    case 'deleted':
      return 'error';
    case 'renamed':
      return 'info';
    default:
      return 'warning';
  }
}
