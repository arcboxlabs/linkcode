import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';

export const FILE_PATH_TOOLTIP_CLASS_NAME = 'max-w-80 break-all font-mono text-left';

/** Wraps an action element in a coss-ui Tooltip; passes it through untouched when no tooltip is given. */
export function withTooltip(
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- TooltipTrigger's `render` prop clones a concrete element; ReactNode is not assignable to it.
  trigger: React.ReactElement,
  tooltip: string | undefined,
  contentClassName?: string,
): React.ReactNode {
  if (!tooltip) return trigger;

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent className={contentClassName}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
