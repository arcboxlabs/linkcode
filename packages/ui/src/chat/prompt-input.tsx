import { Button } from 'coss-ui/components/button';
import { InputGroup, InputGroupAddon, InputGroupTextarea } from 'coss-ui/components/input-group';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import type { ComponentProps, KeyboardEventHandler, ReactNode, SyntheticEvent } from 'react';
import { cn } from '../lib/cn';

export interface PromptInputMessage {
  text: string;
}

type PromptInputSubmitEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

export type PromptInputProps = Omit<ComponentProps<'form'>, 'onSubmit'> & {
  onSubmit: (message: PromptInputMessage, event: PromptInputSubmitEvent) => void;
};

export function PromptInput({
  className,
  children,
  onSubmit,
  ...props
}: PromptInputProps): ReactNode {
  function handleSubmit(event: PromptInputSubmitEvent): void {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const raw = formData.get('message');
    onSubmit({ text: typeof raw === 'string' ? raw : '' }, event);
  }

  return (
    <form className={cn('w-full', className)} onSubmit={handleSubmit} {...props}>
      <InputGroup className="overflow-hidden rounded-2xl bg-card shadow-xs focus-within:border-ring">
        {children}
      </InputGroup>
    </form>
  );
}

export type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea> & {
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
};

export function PromptInputTextarea({
  className,
  name = 'message',
  rows = 1,
  ...props
}: PromptInputTextareaProps): ReactNode {
  return (
    <InputGroupTextarea
      className={cn('max-h-48 px-3.5 pt-3 pb-1.5', className)}
      name={name}
      rows={rows}
      {...props}
    />
  );
}

export type PromptInputFooterProps = Omit<ComponentProps<typeof InputGroupAddon>, 'align'>;

export function PromptInputFooter({ className, ...props }: PromptInputFooterProps): ReactNode {
  return (
    <InputGroupAddon
      align="block-end"
      className={cn('flex items-center gap-2 px-3 pb-2.5', className)}
      {...props}
    />
  );
}

export type PromptInputToolsProps = ComponentProps<'div'>;

export function PromptInputTools({ className, ...props }: PromptInputToolsProps): ReactNode {
  // `flex-1` lets the tools cluster fill the row so trailing addons (Submit) sit
  // flush right without each call site adding its own `ml-auto` spacer.
  return <div className={cn('flex min-w-0 flex-1 items-center gap-2', className)} {...props} />;
}

export type PromptInputButtonProps = ComponentProps<typeof Button>;

export function PromptInputButton({
  size = 'icon-sm',
  type = 'button',
  variant = 'ghost',
  ...props
}: PromptInputButtonProps): ReactNode {
  return <Button size={size} type={type} variant={variant} {...props} />;
}

export type PromptInputSubmitStatus = 'ready' | 'submitted' | 'streaming' | 'error';

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: PromptInputSubmitStatus;
  onStop?: () => void;
};

export function PromptInputSubmit({
  status = 'ready',
  onStop,
  onClick,
  children,
  size = 'icon-sm',
  variant = 'default',
  ...props
}: PromptInputSubmitProps): ReactNode {
  const isRunning = status === 'submitted' || status === 'streaming';

  return (
    <Button
      onClick={(event) => {
        if (isRunning && onStop) {
          event.preventDefault();
          onStop();
          return;
        }
        onClick?.(event);
      }}
      size={size}
      type={isRunning && onStop ? 'button' : 'submit'}
      variant={variant}
      {...props}
    >
      {children ?? (isRunning ? <SquareIcon /> : <ArrowUpIcon />)}
    </Button>
  );
}
