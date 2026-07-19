// biome-ignore-all format: This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui
// biome-ignore-all lint: This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui
/* eslint-disable -- This file is pulled from https://github.com/cosscom/coss/commits/main/packages/ui */
"use client";

import { Form as FormPrimitive } from "@base-ui/react/form";
import type React from "react";

export function Form({
  className,
  ...props
}: FormPrimitive.Props): React.ReactElement {
  return <FormPrimitive className={className} data-slot="form" {...props} />;
}

export { FormPrimitive };
