import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { CheckIcon, CopyIcon, FileIcon, GitCommitIcon, MinusIcon, PlusIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';

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

export type CommitProps = ComponentProps<typeof Collapsible> & {
  commit: ChatCommit;
};

export function Commit({
  className,
  commit,
  defaultOpen = false,
  children,
  ...props
}: CommitProps): ReactNode {
  return (
    <Collapsible
      className={cn(
        'my-2 overflow-hidden rounded-lg border border-border bg-card text-[13px]',
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

export type CommitHeaderProps = ComponentProps<'div'> & {
  commit: ChatCommit;
};

export function CommitHeader({
  className,
  commit,
  children,
  ...props
}: CommitHeaderProps): ReactNode {
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
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <CommitAvatar commit={commit} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">{commit.message}</div>
              <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
                <CommitHash hash={commit.hash} />
                {commit.authorName ? <span className="truncate">{commit.authorName}</span> : null}
                {commit.createdAt ? (
                  <time dateTime={commit.createdAt}>{commit.createdAt}</time>
                ) : null}
              </div>
            </div>
          </CollapsibleTrigger>
          <CommitCopyButton hash={commit.hash} />
        </>
      )}
    </div>
  );
}

export type CommitAvatarProps = ComponentProps<'span'> & {
  commit: ChatCommit;
};

export function CommitAvatar({ className, commit, ...props }: CommitAvatarProps): ReactNode {
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-[12px]',
        className,
      )}
      {...props}
    >
      {commit.authorInitials ?? <GitCommitIcon className="size-4 text-muted-foreground" />}
    </span>
  );
}

export type CommitHashProps = ComponentProps<'span'> & {
  hash: string;
};

export function CommitHash({ className, hash, ...props }: CommitHashProps): ReactNode {
  return (
    <span className={cn('inline-flex items-center gap-1 font-mono', className)} {...props}>
      <GitCommitIcon className="size-3" />
      {hash.slice(0, 8)}
    </span>
  );
}

export type CommitCopyButtonProps = ComponentProps<typeof Button> & {
  hash: string;
  timeout?: number;
};

export function CommitCopyButton({
  className,
  hash,
  timeout = 1600,
  children,
  ...props
}: CommitCopyButtonProps): ReactNode {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const Icon = copied ? CheckIcon : CopyIcon;

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  return (
    <Button
      aria-label={copied ? 'Copied commit hash' : 'Copy commit hash'}
      className={cn('size-6 shrink-0', className)}
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard
          .writeText(hash)
          .then(() => {
            setCopied(true);
            if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
            timeoutRef.current = window.setTimeout(() => setCopied(false), timeout);
          })
          .catch(() => setCopied(false));
      }}
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon className="size-3.5" />}
    </Button>
  );
}

export type CommitContentProps = ComponentProps<typeof CollapsibleContent>;

export function CommitContent({ className, ...props }: CommitContentProps): ReactNode {
  return <CollapsibleContent className={cn('border-t border-border p-2', className)} {...props} />;
}

export type CommitFilesProps = ComponentProps<'div'> & {
  files: readonly ChatCommitFile[];
};

export function CommitFiles({ className, files, children, ...props }: CommitFilesProps): ReactNode {
  return (
    <div className={cn('space-y-1', className)} {...props}>
      {children ?? files.map((file) => <CommitFile key={file.id} file={file} />)}
    </div>
  );
}

export type CommitFileProps = ComponentProps<'div'> & {
  file: ChatCommitFile;
};

export function CommitFile({ className, file, children, ...props }: CommitFileProps): ReactNode {
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
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{file.path}</span>
          <CommitFileChanges additions={file.additions} deletions={file.deletions} />
        </>
      )}
    </div>
  );
}

export type CommitFileStatusProps = ComponentProps<typeof Badge> & {
  status: ChatCommitFile['status'];
};

export function CommitFileStatus({
  className,
  status,
  children,
  ...props
}: CommitFileStatusProps): ReactNode {
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

export type CommitFileChangesProps = ComponentProps<'div'> & {
  additions?: number;
  deletions?: number;
};

export function CommitFileChanges({
  className,
  additions = 0,
  deletions = 0,
  ...props
}: CommitFileChangesProps): ReactNode {
  if (additions === 0 && deletions === 0) return null;

  return (
    <div
      className={cn('flex shrink-0 items-center gap-1 font-mono text-[12px]', className)}
      {...props}
    >
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
): ComponentProps<typeof Badge>['variant'] {
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
