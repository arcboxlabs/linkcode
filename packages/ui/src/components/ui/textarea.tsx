"use client";

import type * as React from "react";
import { cn } from "../../lib/cn";

export type TextareaProps = React.ComponentProps<"textarea"> & {
  /** Grow with content up to max-height (uses CSS field-sizing where supported). */
  autosize?: boolean;
};

export function Textarea({
  className,
  autosize = true,
  ...props
}: TextareaProps): React.ReactElement {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full min-w-0 resize-none bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/72 disabled:opacity-64 sm:text-sm",
        autosize && "field-sizing-content",
        className,
      )}
      {...props}
    />
  );
}
