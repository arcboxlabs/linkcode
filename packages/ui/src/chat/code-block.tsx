import { cn } from '../lib/cn';
import type { CopyIconButtonProps } from './copy-icon-button';
import { CopyIconButton } from './copy-icon-button';

export interface CodeBlockProps extends React.ComponentProps<'div'> {
  code: string;
  language?: string;
  title?: string;
}

export function CodeBlock({
  code,
  language,
  title,
  className,
  children,
  ...props
}: CodeBlockProps): React.ReactNode {
  const hasHeader = Boolean(title || language || children);

  return (
    <div
      className={cn('my-2 overflow-hidden rounded-lg border border-border bg-muted', className)}
      data-language={language}
      {...props}
    >
      {hasHeader ? (
        <CodeBlockHeader>
          <CodeBlockTitle>{title ?? language}</CodeBlockTitle>
          {children}
        </CodeBlockHeader>
      ) : null}
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export type CodeBlockHeaderProps = React.ComponentProps<'div'>;

export function CodeBlockHeader({ className, ...props }: CodeBlockHeaderProps): React.ReactNode {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-1.5 text-[12px]',
        className,
      )}
      {...props}
    />
  );
}

export type CodeBlockTitleProps = React.ComponentProps<'div'>;

export function CodeBlockTitle({ className, ...props }: CodeBlockTitleProps): React.ReactNode {
  return <div className={cn('truncate font-mono text-muted-foreground', className)} {...props} />;
}

export type CodeBlockActionsProps = React.ComponentProps<'div'>;

export function CodeBlockActions({ className, ...props }: CodeBlockActionsProps): React.ReactNode {
  return <div className={cn('-my-1 flex items-center gap-1', className)} {...props} />;
}

export type CodeBlockCopyButtonProps = Omit<CopyIconButtonProps, 'value'> & {
  code: string;
};

export function CodeBlockCopyButton({ code, ...props }: CodeBlockCopyButtonProps): React.ReactNode {
  return <CopyIconButton value={code} {...props} />;
}
