import { Button } from 'coss-ui/components/button';
import type { ComponentProps, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: 'user' | 'assistant';
};

export function Message({ className, from, ...props }: MessageProps): ReactNode {
  return (
    <div
      className={cn(
        'group flex w-full flex-col gap-2',
        from === 'user' ? 'is-user items-end' : 'is-assistant items-start',
        className,
      )}
      data-role={from}
      {...props}
    />
  );
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({ className, children, ...props }: MessageContentProps): ReactNode {
  return (
    <div
      className={cn(
        'min-w-0 max-w-full text-[14px] leading-relaxed',
        'group-[.is-user]:max-w-[80%] group-[.is-user]:break-words group-[.is-user]:rounded-2xl group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-secondary-foreground',
        'group-[.is-assistant]:w-full group-[.is-assistant]:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type MessageActionsProps = ComponentProps<'div'>;

export function MessageActions({ className, ...props }: MessageActionsProps): ReactNode {
  return <div className={cn('flex items-center gap-1', className)} {...props} />;
}

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export function MessageAction({
  tooltip,
  label,
  children,
  size = 'icon-sm',
  variant = 'ghost',
  ...props
}: MessageActionProps): ReactNode {
  return (
    <Button
      aria-label={label ?? tooltip}
      size={size}
      title={tooltip}
      type="button"
      variant={variant}
      {...props}
    >
      {children}
    </Button>
  );
}

export type MessageToolbarProps = ComponentProps<'div'>;

export function MessageToolbar({ className, ...props }: MessageToolbarProps): ReactNode {
  return <div className={cn('mt-2 flex w-full items-center gap-2', className)} {...props} />;
}
