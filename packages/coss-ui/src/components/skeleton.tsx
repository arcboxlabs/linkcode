// biome-ignore-all format: This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui
// biome-ignore-all lint: This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui
/* eslint-disable -- This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui */
import type React from "react";
import { cn } from "coss-ui/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "animate-skeleton rounded-sm [--skeleton-highlight:--alpha(var(--color-white)/64%)] [background:linear-gradient(120deg,transparent_40%,var(--skeleton-highlight),transparent_60%)_var(--color-muted)_0_0/200%_100%_fixed] dark:[--skeleton-highlight:--alpha(var(--color-white)/4%)]",
        className,
      )}
      data-slot="skeleton"
      {...props}
    />
  );
}
