import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';

export const FILE_PATH_TOOLTIP_CLASS_NAME = 'max-w-80 break-all font-mono text-left';

// eslint-disable-next-line @typescript-eslint/no-restricted-types -- TooltipTrigger's `render` prop clones a concrete element; ReactNode is not assignable to it.
type TooltipTriggerElement = React.ReactElement;

/** Wraps an action element in a coss-ui Tooltip; passes it through untouched when no tooltip is given. */
export function withTooltip(
  trigger: TooltipTriggerElement,
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

/** Keeps the whole control focusable while positioning a long path beside its file identity. */
export function FilePathTooltip({
  anchor,
  children,
  tooltip,
}: {
  anchor: NonNullable<React.ComponentProps<typeof TooltipContent>['anchor']>;
  children: TooltipTriggerElement;
  tooltip: string | undefined;
}): React.ReactNode {
  if (!tooltip) return children;

  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent align="start" anchor={anchor} className={FILE_PATH_TOOLTIP_CLASS_NAME}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
