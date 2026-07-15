import { Card, CardHeader, CardPanel, CardTitle } from 'coss-ui/components/card';
import { cn } from '../lib/cn';
import type { CopyIconButtonProps } from './copy-icon-button';
import { CopyIconButton } from './copy-icon-button';

export interface CodeBlockProps extends React.ComponentProps<typeof Card> {
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
    <Card className={cn('my-2 overflow-hidden', className)} data-language={language} {...props}>
      {hasHeader ? (
        <CodeBlockHeader>
          <CodeBlockTitle>{title ?? language}</CodeBlockTitle>
          {children}
        </CodeBlockHeader>
      ) : null}
      <CardPanel className="p-0">
        <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
          <code>{code}</code>
        </pre>
      </CardPanel>
    </Card>
  );
}

export type CodeBlockHeaderProps = React.ComponentProps<typeof CardHeader>;

export function CodeBlockHeader({ className, ...props }: CodeBlockHeaderProps): React.ReactNode {
  return (
    <CardHeader
      className={cn(
        'grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto] items-center gap-2 border-b bg-muted px-3 py-1.5 text-xs in-[[data-slot=card]:has(>[data-slot=card-panel])]:pb-1.5',
        className,
      )}
      {...props}
    />
  );
}

export type CodeBlockTitleProps = React.ComponentProps<typeof CardTitle>;

export function CodeBlockTitle({ className, ...props }: CodeBlockTitleProps): React.ReactNode {
  return (
    <CardTitle
      className={cn(
        'truncate font-mono font-normal text-muted-foreground text-xs leading-normal',
        className,
      )}
      {...props}
    />
  );
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
