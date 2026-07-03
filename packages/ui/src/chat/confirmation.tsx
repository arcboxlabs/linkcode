import { Button } from 'coss-ui/components/button';
import { ShieldIcon } from 'lucide-react';
import { cn } from '../lib/cn';

export type ConfirmationProps = React.ComponentProps<'div'>;

export function Confirmation({ className, ...props }: ConfirmationProps): React.ReactNode {
  return (
    <div
      className={cn('my-1 rounded-xl border border-warning/40 bg-warning/5 p-3', className)}
      {...props}
    />
  );
}

export type ConfirmationTitleProps = React.ComponentProps<'div'> & {
  title: string;
  subject?: string;
  iconClassName?: string;
};

export function ConfirmationTitle({
  className,
  iconClassName,
  title,
  subject,
  children,
  ...props
}: ConfirmationTitleProps): React.ReactNode {
  return (
    <div
      className={cn(
        'mb-2 flex items-center gap-2 text-[13px] font-medium text-foreground',
        className,
      )}
      {...props}
    >
      <ShieldIcon className={cn('size-4 shrink-0 text-warning-foreground', iconClassName)} />
      {children ?? (
        <>
          {title}
          {subject ? (
            <span className="truncate font-normal text-muted-foreground">{subject}</span>
          ) : null}
        </>
      )}
    </div>
  );
}

export type ConfirmationDescriptionProps = React.ComponentProps<'div'>;

export function ConfirmationDescription({
  className,
  ...props
}: ConfirmationDescriptionProps): React.ReactNode {
  return <div className={cn('text-[13px] text-muted-foreground', className)} {...props} />;
}

export type ConfirmationActionsProps = React.ComponentProps<'div'>;

export function ConfirmationActions({
  className,
  ...props
}: ConfirmationActionsProps): React.ReactNode {
  return <div className={cn('flex flex-wrap gap-2', className)} {...props} />;
}

export type ConfirmationActionProps = React.ComponentProps<typeof Button>;

export function ConfirmationAction({
  size = 'sm',
  type = 'button',
  ...props
}: ConfirmationActionProps): React.ReactNode {
  return <Button size={size} type={type} {...props} />;
}
