import { cn } from "@/lib/utils";

/**
 * Placeholder block for content that has not arrived yet.
 *
 * The pulse is the `.skeleton` utility rather than Tailwind's `animate-pulse`,
 * because the loop length is derived from the theme's motion token — a theme
 * that asks for brisk motion gets a brisk shimmer, and one that asks for none
 * gets a still block.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton", className)} {...props} />;
}

export { Skeleton };