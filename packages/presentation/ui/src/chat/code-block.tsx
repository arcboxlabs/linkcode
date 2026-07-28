import { Frame } from 'coss-ui/components/frame';
import { cn } from '../lib/cn';
import { ChatCardActions, ChatCardHeader, ChatCardPanel, ChatCardTitle } from './chat-card';
import type { CopyIconButtonProps } from './copy-icon-button';
import { CopyIconButton } from './copy-icon-button';
import { HighlightedCode } from './highlighted-code';

export interface CodeBlockProps extends React.ComponentProps<typeof Frame> {
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
  if (!title && !language && !children) {
    return (
      <ChatCardPanel
        className={cn('my-2 overflow-hidden p-0', className)}
        data-language={language}
        {...props}
      >
        <HighlightedCode className="p-3" code={code} language={language} />
      </ChatCardPanel>
    );
  }

  return (
    <Frame className={cn('my-2', className)} data-language={language} {...props}>
      <ChatCardHeader>
        <ChatCardTitle>{title ?? language}</ChatCardTitle>
        {children ?? (
          <ChatCardActions>
            <CodeBlockCopyButton code={code} />
          </ChatCardActions>
        )}
      </ChatCardHeader>
      <ChatCardPanel className="overflow-hidden p-0">
        <HighlightedCode className="p-3" code={code} language={language} />
      </ChatCardPanel>
    </Frame>
  );
}

export type CodeBlockCopyButtonProps = Omit<CopyIconButtonProps, 'value'> & {
  code: string;
};

export function CodeBlockCopyButton({ code, ...props }: CodeBlockCopyButtonProps): React.ReactNode {
  return <CopyIconButton value={code} {...props} />;
}
