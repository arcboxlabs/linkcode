import { Button } from 'coss-ui/components/button';
import { cn } from '../lib/cn';
import { WithTooltip } from './with-tooltip';

export type MessageProps = React.HTMLAttributes<HTMLDivElement> & {
  from: 'user' | 'assistant';
};

export function Message({ className, from, ...props }: MessageProps): React.ReactNode {
  return (
    <div
      className={cn(
        'group flex w-full flex-col gap-2',
        from === 'user' ? 'items-end' : 'items-start',
        className,
      )}
      data-role={from}
      {...props}
    />
  );
}

export type MessageContentProps = React.HTMLAttributes<HTMLDivElement>;

export function MessageContent({
  className,
  children,
  ...props
}: MessageContentProps): React.ReactNode {
  return (
    <div
      className={cn(
        'min-w-0 max-w-full text-sm leading-relaxed',
        'group-data-[role=user]:break-words group-data-[role=user]:rounded-2xl group-data-[role=user]:bg-secondary group-data-[role=user]:px-3.5 group-data-[role=user]:py-2.5 group-data-[role=user]:text-secondary-foreground sm:group-data-[role=user]:max-w-2xl',
        'group-data-[role=assistant]:w-full group-data-[role=assistant]:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type MessageActionsProps = React.ComponentProps<'div'>;

export function MessageActions({ className, ...props }: MessageActionsProps): React.ReactNode {
  return <div className={cn('flex items-center gap-1', className)} {...props} />;
}

export type MessageActionProps = React.ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export function MessageAction({
  tooltip,
  label,
  children,
  size = 'icon-xs',
  variant = 'ghost',
  ...props
}: MessageActionProps): React.ReactNode {
  return (
    <WithTooltip tooltip={tooltip}>
      <Button aria-label={label ?? tooltip} size={size} type="button" variant={variant} {...props}>
        {children}
      </Button>
    </WithTooltip>
  );
}

export type MessageToolbarProps = React.ComponentProps<'div'>;

export function MessageToolbar({ className, ...props }: MessageToolbarProps): React.ReactNode {
  return <div className={cn('mt-2 flex w-full items-center gap-2', className)} {...props} />;
}
