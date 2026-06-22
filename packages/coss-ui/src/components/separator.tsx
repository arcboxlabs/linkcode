// biome-ignore-all format: This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui
// biome-ignore-all lint: This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui
/* eslint-disable -- This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui */
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import type React from "react";
import { cn } from "coss-ui/lib/utils";

export function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props): React.ReactElement {
  return (
    <SeparatorPrimitive
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:not-[[class^='h-']]:not-[[class*='_h-']]:self-stretch",
        className,
      )}
      data-slot="separator"
      orientation={orientation}
      {...props}
    />
  );
}

export { SeparatorPrimitive };
