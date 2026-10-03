import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * `rounded-badge`, not `rounded-full`: pill-shaped badges are one theme's
 * choice, not the product's. Paper gives them a printed-tab radius, Neon a
 * square one and Focus a barely-softened one, so the shape language reaches the
 * smallest components too.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-badge border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        success: "border-transparent bg-success/15 text-success [&_svg]:text-success",
        warning: "border-transparent bg-warning/15 text-warning [&_svg]:text-warning",
        danger: "border-transparent bg-danger/15 text-danger",
        accent: "border-transparent bg-accent text-accent-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };