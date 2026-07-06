import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';

/** Wraps an action element in a coss-ui Tooltip; passes it through untouched when no tooltip is given. */
export function withTooltip(
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- TooltipTrigger's `render` prop clones a concrete element; ReactNode is not assignable to it.
  trigger: React.ReactElement,
  tooltip: string | undefined,
): React.ReactNode {
  if (!tooltip) return trigger;

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
