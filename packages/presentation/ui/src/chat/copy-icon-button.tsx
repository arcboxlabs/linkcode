import { Button } from 'coss-ui/components/button';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { useCopyButton } from './use-copy-button';

export type CopyIconButtonProps = Omit<React.ComponentProps<typeof Button>, 'onClick'> & {
  value: string;
  label?: string;
  timeout?: number;
  stopPropagation?: boolean;
  iconClassName?: string;
};

/** Internal icon-button recipe shared by the chat copy actions (code block, snippet, commit, stack trace). */
export function CopyIconButton({
  value,
  label,
  timeout = 1600,
  stopPropagation = false,
  iconClassName,
  className,
  children,
  ...props
}: CopyIconButtonProps): React.ReactNode {
  const { copied, copyValue } = useCopyButton(value, timeout);
  const suffix = label ? ` ${label}` : '';

  return (
    <Button
      aria-label={copied ? `Copied${suffix}` : `Copy${suffix}`}
      className={cn('size-6', className)}
      onClick={(event) => {
        if (stopPropagation) event.stopPropagation();
        copyValue();
      }}
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ??
        (copied ? <CheckIcon className={iconClassName} /> : <CopyIcon className={iconClassName} />)}
    </Button>
  );
}
