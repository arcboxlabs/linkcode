import { Alert, AlertDescription, AlertTitle } from 'coss-ui/components/alert';
import { Button } from 'coss-ui/components/button';
import { ShieldIcon } from 'lucide-react';
import { cn } from '../lib/cn';

export type ConfirmationProps = React.ComponentProps<typeof Alert>;

export function Confirmation({ className, ...props }: ConfirmationProps): React.ReactNode {
  return <Alert className={cn('my-1', className)} variant="warning" {...props} />;
}

export type ConfirmationTitleProps = React.ComponentProps<typeof AlertTitle> & {
  title: string;
  subject?: string;
};

export function ConfirmationTitle({
  className,
  title,
  subject,
  children,
  ...props
}: ConfirmationTitleProps): React.ReactNode {
  return (
    <>
      <ShieldIcon />
      <AlertTitle className={cn('flex min-w-0 items-center gap-2', className)} {...props}>
        {children ?? (
          <>
            {title}
            {subject ? (
              <span className="truncate font-normal text-muted-foreground">{subject}</span>
            ) : null}
          </>
        )}
      </AlertTitle>
    </>
  );
}

export type ConfirmationDescriptionProps = React.ComponentProps<typeof AlertDescription>;

export function ConfirmationDescription({
  ...props
}: ConfirmationDescriptionProps): React.ReactNode {
  return <AlertDescription {...props} />;
}

export type ConfirmationActionsProps = React.ComponentProps<'div'>;

export function ConfirmationActions({
  className,
  ...props
}: ConfirmationActionsProps): React.ReactNode {
  // col-start-2 keeps the actions aligned with the title text, past the Alert icon column.
  return <div className={cn('col-start-2 mt-1.5 flex flex-wrap gap-2', className)} {...props} />;
}

export type ConfirmationActionProps = React.ComponentProps<typeof Button>;

export function ConfirmationAction({
  size = 'sm',
  type = 'button',
  ...props
}: ConfirmationActionProps): React.ReactNode {
  return <Button size={size} type={type} {...props} />;
}
