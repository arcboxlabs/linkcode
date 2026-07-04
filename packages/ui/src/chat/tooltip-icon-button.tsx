import { Button } from 'coss-ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';

export type TooltipIconButtonProps = React.ComponentProps<typeof Button> & {
  tooltip?: string;
};

/** Internal icon-button recipe: a coss-ui Button, wrapped in a Tooltip only when `tooltip` is set. */
export function TooltipIconButton({
  tooltip,
  children,
  size = 'icon-xs',
  variant = 'ghost',
  ...props
}: TooltipIconButtonProps): React.ReactNode {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
    </Button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
