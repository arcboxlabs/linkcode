import { Button } from 'coss-ui/components/button';
import { Card } from 'coss-ui/components/card';
import { XIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import type { TooltipIconButtonProps } from './tooltip-icon-button';
import { TooltipIconButton } from './tooltip-icon-button';

// TODO(linkcode-schema): Provisional UI-only artifact metadata, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when generated artifacts are emitted by the data plane.
export interface ChatArtifact {
  id: string;
  title: string;
  description?: string;
  kind?: 'code' | 'document' | 'image' | 'preview' | 'unknown';
}

export type ArtifactProps = React.ComponentProps<'div'> & {
  artifact?: ChatArtifact;
  onClose?: () => void;
};

export function Artifact({
  className,
  artifact,
  onClose,
  children,
  ...props
}: ArtifactProps): React.ReactNode {
  return (
    <Card className={cn('my-2 min-h-0 overflow-hidden', className)} {...props}>
      {children ?? (
        <>
          <ArtifactHeader>
            <div className="min-w-0">
              <ArtifactTitle>{artifact?.title}</ArtifactTitle>
              {artifact?.description ? (
                <ArtifactDescription>{artifact.description}</ArtifactDescription>
              ) : null}
            </div>
            {onClose ? <ArtifactClose onClick={onClose} /> : null}
          </ArtifactHeader>
          <ArtifactContent />
        </>
      )}
    </Card>
  );
}

export type ArtifactHeaderProps = React.ComponentProps<'div'>;

export function ArtifactHeader({ className, ...props }: ArtifactHeaderProps): React.ReactNode {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-b border-border px-3 py-2',
        className,
      )}
      {...props}
    />
  );
}

export type ArtifactTitleProps = React.ComponentProps<'div'>;

export function ArtifactTitle({ className, ...props }: ArtifactTitleProps): React.ReactNode {
  return (
    <div className={cn('truncate font-medium text-[13px] text-foreground', className)} {...props} />
  );
}

export type ArtifactDescriptionProps = React.ComponentProps<'div'>;

export function ArtifactDescription({
  className,
  ...props
}: ArtifactDescriptionProps): React.ReactNode {
  return <div className={cn('truncate text-[12px] text-muted-foreground', className)} {...props} />;
}

export type ArtifactActionsProps = React.ComponentProps<'div'>;

export function ArtifactActions({ className, ...props }: ArtifactActionsProps): React.ReactNode {
  return <div className={cn('flex items-center gap-1', className)} {...props} />;
}

export type ArtifactActionProps = TooltipIconButtonProps;

export function ArtifactAction({ className, ...props }: ArtifactActionProps): React.ReactNode {
  return <TooltipIconButton className={cn('size-7', className)} {...props} />;
}

export type ArtifactCloseProps = React.ComponentProps<typeof Button>;

export function ArtifactClose({
  className,
  children,
  size = 'icon-xs',
  variant = 'ghost',
  ...props
}: ArtifactCloseProps): React.ReactNode {
  return (
    <Button
      aria-label="Close artifact"
      className={cn('size-7', className)}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children ?? <XIcon className="size-3.5" />}
    </Button>
  );
}

export type ArtifactContentProps = React.ComponentProps<'div'>;

export function ArtifactContent({ className, ...props }: ArtifactContentProps): React.ReactNode {
  return <div className={cn('min-h-0 flex-1 overflow-auto p-3', className)} {...props} />;
}
