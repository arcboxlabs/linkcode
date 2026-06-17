"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../../lib/cn";

export const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 font-medium text-[11px] leading-none [&_svg]:size-3 [&_svg]:pointer-events-none",
  {
    defaultVariants: { variant: "secondary" },
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border bg-transparent text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        success: "border-transparent bg-success/12 text-success-foreground",
        info: "border-transparent bg-info/12 text-info-foreground",
        warning: "border-transparent bg-warning/12 text-warning-foreground",
        destructive: "border-transparent bg-destructive/12 text-destructive-foreground",
      },
    },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.ReactElement {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
