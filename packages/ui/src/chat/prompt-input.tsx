import { Button } from 'coss-ui/components/button';
import { InputGroup, InputGroupAddon } from 'coss-ui/components/input-group';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { cn } from '../lib/cn';

export interface PromptInputMessage {
  text: string;
}

type PromptInputSubmitEvent = React.SyntheticEvent<HTMLFormElement, SubmitEvent>;

export type PromptInputProps = Omit<React.ComponentProps<'form'>, 'onSubmit'> & {
  onSubmit: (message: PromptInputMessage, event: PromptInputSubmitEvent) => void;
};

export function PromptInput({
  className,
  children,
  onSubmit,
  ...props
}: PromptInputProps): React.ReactNode {
  function handleSubmit(event: PromptInputSubmitEvent): void {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const raw = formData.get('message');
    onSubmit({ text: typeof raw === 'string' ? raw : '' }, event);
  }

  return (
    <form className={cn('w-full', className)} onSubmit={handleSubmit} {...props}>
      {/* The group's own focus/disabled styling keys on literal input/textarea selectors; the
       * composer's contenteditable editor needs these equivalents keyed on its data-slot. */}
      <InputGroup className="overflow-hidden rounded-2xl bg-card shadow-none has-[[data-slot=composer-editor][contenteditable=false]]:opacity-64 has-[[data-slot=composer-editor][contenteditable=false]]:before:shadow-none has-[[data-slot=composer-editor]:focus-visible]:border-ring has-[[data-slot=composer-editor]:focus-visible]:ring-[3px] has-[[data-slot=composer-editor]:focus-visible]:before:shadow-none">
        {children}
      </InputGroup>
    </form>
  );
}

export type PromptInputFooterProps = Omit<React.ComponentProps<typeof InputGroupAddon>, 'align'>;

export function PromptInputFooter({
  className,
  ...props
}: PromptInputFooterProps): React.ReactNode {
  return (
    <InputGroupAddon
      align="block-end"
      className={cn('flex items-center gap-2 px-3 pb-2.5', className)}
      {...props}
    />
  );
}

export type PromptInputToolsProps = React.ComponentProps<'div'>;

export function PromptInputTools({ className, ...props }: PromptInputToolsProps): React.ReactNode {
  // `flex-1` lets the tools cluster fill the row so trailing addons (Submit) sit
  // flush right without each call site adding its own `ml-auto` spacer.
  return <div className={cn('flex min-w-0 flex-1 items-center gap-2', className)} {...props} />;
}

export type PromptInputButtonProps = React.ComponentProps<typeof Button>;

export function PromptInputButton({
  size = 'icon-sm',
  type = 'button',
  variant = 'ghost',
  ...props
}: PromptInputButtonProps): React.ReactNode {
  return <Button size={size} type={type} variant={variant} {...props} />;
}

export type PromptInputSubmitStatus = 'ready' | 'submitted' | 'streaming' | 'error';

export type PromptInputSubmitProps = React.ComponentProps<typeof Button> & {
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
}: PromptInputSubmitProps): React.ReactNode {
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
