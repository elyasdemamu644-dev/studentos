import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[var(--press-scale)]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-card hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-card hover:bg-destructive/90",
        outline: "border border-input bg-background shadow-inset hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-inset hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        success: "bg-success text-success-foreground shadow-card hover:bg-success/90",
        // `danger` and `warning` are the semantic names; `destructive` is the
        // Radix/shadcn slot name for the same colour. Both exist so pages stop
        // hand-rolling raw colour classes for destructive actions.
        danger: "bg-danger text-danger-foreground shadow-card hover:bg-danger/90",
        warning: "bg-warning text-warning-foreground shadow-card hover:bg-warning/90",
      },
      // Heights and padding come from the theme's density tokens so a dense
      // theme (Neon) tightens every control in the product at once, and an airy
      // one (Aurora, Paper) loosens it.
      size: {
        default: "h-control px-control",
        sm: "h-control-sm rounded-md px-control-sm text-xs",
        lg: "h-control-lg rounded-md px-control-lg",
        icon: "h-control w-control",
        "icon-sm": "h-control-sm w-control-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };/**
 * Shared loading button primitive used across forms.
 */
export function LoadingButton({ children, loading, ...props }: ButtonProps & { loading?: boolean }) {
  return (
    <Button {...props} disabled={loading || props.disabled} aria-busy={loading}>
      {loading && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </Button>
  );
}