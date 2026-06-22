// biome-ignore-all format: This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui
// biome-ignore-all lint: This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui
/* eslint-disable -- This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui */
"use client";

import { Fieldset as FieldsetPrimitive } from "@base-ui/react/fieldset";
import type React from "react";
import { cn } from "coss-ui/lib/utils";

export function Fieldset({
  className,
  ...props
}: FieldsetPrimitive.Root.Props): React.ReactElement {
  return (
    <FieldsetPrimitive.Root
      className={className}
      data-slot="fieldset"
      {...props}
    />
  );
}
export function FieldsetLegend({
  className,
  ...props
}: FieldsetPrimitive.Legend.Props): React.ReactElement {
  return (
    <FieldsetPrimitive.Legend
      className={cn("font-semibold text-foreground", className)}
      data-slot="fieldset-legend"
      {...props}
    />
  );
}

export { FieldsetPrimitive };
