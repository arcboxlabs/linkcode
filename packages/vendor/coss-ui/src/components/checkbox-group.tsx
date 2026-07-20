// biome-ignore-all format: This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui
// biome-ignore-all lint: This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui
/* eslint-disable -- This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui */
"use client";

import { CheckboxGroup as CheckboxGroupPrimitive } from "@base-ui/react/checkbox-group";
import type React from "react";
import { cn } from "coss-ui/lib/utils";

export function CheckboxGroup({
  className,
  ...props
}: CheckboxGroupPrimitive.Props): React.ReactElement {
  return (
    <CheckboxGroupPrimitive
      className={cn("flex flex-col items-start gap-3", className)}
      {...props}
    />
  );
}

export { CheckboxGroupPrimitive };
